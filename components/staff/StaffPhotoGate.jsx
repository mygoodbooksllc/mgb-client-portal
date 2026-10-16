// Required staff profile photo (docs/staff-photo-spec.md, Part G1).
//
//   PG_Gate         full-page overlay that blocks the app until the signed-in
//                   staffer has a photo. Settings and Sign out stay reachable.
//                   Mounted first in line by app.jsx; tours, tips, the
//                   announcements and Today's first-sign-in prompt wait while
//                   #pg-gate exists (TOUR_staffHold / TOUR_staffBusy).
//   PG_PhotoPicker  choose / take a photo, crop it to a circle, upload it.
//                   Shared by the gate and Settings › Profile (Change photo).
//   PG_Webcam       live camera capture on desktop browsers.
//
// Data and rules: components/staff/staffPhotoApi.js (SP_*), staffPhotoImage.js
// (SPI_*), staffPhotoLogic.js (pure rules). The database enforces everything
// (supabase/staff-photo.sql); this file only mirrors it. Nothing is stored in
// localStorage: "Continue for now" lasts for this page load only.
//
// Loaded in the shared global scope after Settings.jsx: every top-level name
// has a PG_ prefix, hooks are used as React.*. ModalShell, ST_Avatar and
// ST_profile are only touched at render time.

// "Continue for now" after an upload error hides the gate until the next page
// load. In memory on purpose.
let PG_dismissedThisLoad = false;

const PG_VIEW_PX = 480; // canvas resolution of the crop preview (shown at most 320 CSS px)

const PG_HEIC_TEXT =
  "This photo is in HEIC format, which this browser can't open. On a Mac, open it in Preview and choose File › Export › JPEG. On an iPhone, set Settings › Camera › Formats to Most Compatible, or take a screenshot of the photo, then try again.";

function PG_prefersCamera() {
  try {
    return !!window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  } catch (e) {
    return false;
  }
}

function PG_canWebcam() {
  return !!(typeof navigator !== "undefined" && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// Keeps zoom and center inside the image, and re-derives the center from the
// clamped crop so dragging past an edge doesn't build up hidden slack.
function PG_normView(img, v) {
  const maxZoom = SP_maxZoom(img.width, img.height);
  const zoom = Math.min(Math.max(Number(v.zoom) || 1, 1), maxZoom);
  const r = SP_cropRect({ imgW: img.width, imgH: img.height, zoom, cx: v.cx, cy: v.cy });
  return { zoom, cx: (r.sx + r.sSize / 2) / img.width, cy: (r.sy + r.sSize / 2) / img.height };
}

function PG_releaseImage(img) {
  if (!img) return;
  try {
    if (img.source && typeof img.source.close === "function") img.source.close();
  } catch (e) {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Webcam capture (fine pointers with getUserMedia).
// ---------------------------------------------------------------------------
function PG_Webcam({ onCapture, onCancel }) {
  const videoRef = React.useRef(null);
  const streamRef = React.useRef(null);
  const [err, setErr] = React.useState("");
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          const p = v.play();
          if (p && p.catch) p.catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) setErr("Camera access is blocked. Upload a photo instead.");
      });
    return () => {
      cancelled = true;
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);
  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(
      (blob) => {
        if (!blob) return setErr("Couldn't capture the photo. Try again, or upload one instead.");
        if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        onCapture(new File([blob], "camera.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92,
    );
  };
  return (
    <div className="pg-webcam">
      {err ? (
        <div className="pg-alert" role="alert">
          {err}
        </div>
      ) : (
        <div className="pg-video-box">
          <video ref={videoRef} className="pg-video" playsInline muted autoPlay onLoadedData={() => setReady(true)} aria-label="Camera preview" />
        </div>
      )}
      <div className="pg-actions">
        {!err && (
          <button type="button" className="btn-primary pg-btn" onClick={capture} disabled={!ready}>
            Capture
          </button>
        )}
        <button type="button" className="btn-secondary pg-btn" onClick={onCancel}>
          {err ? "Back" : "Cancel"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Picker: choose -> crop -> save.
// ---------------------------------------------------------------------------
function PG_PhotoPicker({ email, onDone, onSkip, compact }) {
  const [step, setStep] = React.useState("choose"); // choose | webcam | crop | saving | done
  const [img, setImg] = React.useState(null); // {source, width, height}
  const [view, setView] = React.useState({ zoom: 1, cx: 0.5, cy: 0.5 });
  const [err, setErr] = React.useState("");
  const [saveFailed, setSaveFailed] = React.useState(false);
  const [over, setOver] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const fileRef = React.useRef(null);
  const captureRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const previewRef = React.useRef(null);
  const boxRef = React.useRef(null);
  const dragRef = React.useRef(null);
  const imgRef = React.useRef(null);
  const viewRef = React.useRef(view);
  viewRef.current = view;
  imgRef.current = img;

  // Free the decoded bitmap when it is replaced or the picker goes away.
  React.useEffect(
    () => () => {
      PG_releaseImage(imgRef.current);
    },
    [],
  );

  const maxZoom = img ? SP_maxZoom(img.width, img.height) : 1;
  const rect = img ? SP_cropRect({ imgW: img.width, imgH: img.height, zoom: view.zoom, cx: view.cx, cy: view.cy }) : null;

  // Draw the big preview and the 48 px circle.
  React.useEffect(() => {
    if (step !== "crop" && step !== "saving") return;
    if (!img || !rect) return;
    const paint = (canvas, px) => {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = px;
      canvas.height = px;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, px, px);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img.source, rect.sx, rect.sy, rect.sSize, rect.sSize, 0, 0, px, px);
    };
    paint(canvasRef.current, PG_VIEW_PX);
    paint(previewRef.current, 96);
  }, [step, img, rect && rect.sx, rect && rect.sy, rect && rect.sSize]);

  // The wheel needs preventDefault, which React's passive listeners don't allow.
  React.useEffect(() => {
    const el = boxRef.current;
    if (!el || step !== "crop") return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const cur = viewRef.current;
      const im = imgRef.current;
      if (!im) return;
      setView(PG_normView(im, { ...cur, zoom: cur.zoom * (1 - e.deltaY * 0.002) }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [step]);

  const reset = () => {
    PG_releaseImage(imgRef.current);
    setImg(null);
    setView({ zoom: 1, cx: 0.5, cy: 0.5 });
    setSaveFailed(false);
    setErr("");
    setStep("choose");
  };

  const handleFile = async (file) => {
    if (!file) return;
    setErr("");
    const ok = SP_validateFile({ type: file.type, size: file.size, name: file.name });
    if (!ok.ok) return setErr(ok.error);
    setLoading(true);
    let loaded = null;
    try {
      loaded = await SPI_loadImage(file);
    } catch (e) {
      setLoading(false);
      return setErr(e && e.code === "heic" ? PG_HEIC_TEXT : "That file couldn't be opened as a photo. Try a different one.");
    }
    setLoading(false);
    if (SP_tooSmall(loaded.width, loaded.height)) {
      PG_releaseImage(loaded);
      return setErr("This photo is too small. Choose one at least 400 × 400 pixels.");
    }
    PG_releaseImage(imgRef.current);
    setImg(loaded);
    setView({ zoom: 1, cx: 0.5, cy: 0.5 });
    setSaveFailed(false);
    setStep("crop");
  };

  const onInput = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    handleFile(file);
  };

  const onTake = () => {
    setErr("");
    if (PG_prefersCamera() || !PG_canWebcam()) {
      if (captureRef.current) captureRef.current.click();
    } else {
      setStep("webcam");
    }
  };

  // Pan with a finger or mouse: the photo follows the pointer.
  const onPointerDown = (e) => {
    if (!img || step !== "crop") return;
    const box = boxRef.current;
    if (!box) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (x) {
      /* ignore */
    }
    dragRef.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, sSize: rect.sSize, size: box.clientWidth || 1 };
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d || !img) return;
    const k = d.sSize / d.size; // source pixels per screen pixel
    setView(
      PG_normView(img, {
        zoom: viewRef.current.zoom,
        cx: d.cx - ((e.clientX - d.x) * k) / img.width,
        cy: d.cy - ((e.clientY - d.y) * k) / img.height,
      }),
    );
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };
  const onKeyDown = (e) => {
    if (!img || step !== "crop") return;
    const k = e.key;
    let dx = 0;
    let dy = 0;
    let dz = 0;
    if (k === "ArrowLeft") dx = -0.02;
    else if (k === "ArrowRight") dx = 0.02;
    else if (k === "ArrowUp") dy = -0.02;
    else if (k === "ArrowDown") dy = 0.02;
    else if (k === "+" || k === "=") dz = 0.1;
    else if (k === "-" || k === "_") dz = -0.1;
    else return;
    e.preventDefault();
    // The photo moves the way the arrow points, the same as dragging it.
    setView(PG_normView(img, { zoom: view.zoom + dz, cx: view.cx - dx, cy: view.cy - dy }));
  };

  const save = async () => {
    if (!img || !rect) return;
    setErr("");
    setSaveFailed(false);
    setStep("saving");
    try {
      const now = Date.now();
      const origPath = SP_paths(email, "original", now);
      const curPath = SP_paths(email, "current", now);
      const origBlob = await SPI_encodeOriginal(img);
      await SP_api.upload(origPath, origBlob, "image/jpeg");
      const curBlob = await SPI_encodeCrop(img, rect, SP_LIMITS.currentSize);
      await SP_api.upload(curPath, curBlob, "image/jpeg");
      await SP_api.submit(origPath, curPath);
    } catch (e) {
      setErr(SP_errText(e));
      setSaveFailed(true);
      setStep("crop");
      return;
    }
    if (typeof ST_profile !== "undefined" && ST_profile && ST_profile.reload) ST_profile.reload();
    setStep("done");
    if (onDone) onDone();
  };

  const alertBox = err ? (
    <div className="pg-alert" role="alert">
      {err}
      {saveFailed && (
        <div className="pg-alert-actions">
          <button type="button" className="btn-secondary pg-btn" onClick={save}>
            Try again
          </button>
          {onSkip && (
            <button type="button" className="btn-secondary pg-btn" onClick={onSkip}>
              Continue for now
            </button>
          )}
        </div>
      )}
    </div>
  ) : null;

  if (step === "done") {
    return (
      <div className={"pg-picker" + (compact ? " pg-picker-compact" : "")}>
        <div className="pg-done" role="status">
          <span className="pg-check" aria-hidden="true">
            ✓
          </span>
          <span>Thanks! Your photo is saved.</span>
        </div>
      </div>
    );
  }

  if (step === "webcam") {
    return (
      <div className={"pg-picker" + (compact ? " pg-picker-compact" : "")}>
        <PG_Webcam
          onCancel={() => setStep("choose")}
          onCapture={(file) => {
            setStep("choose");
            handleFile(file);
          }}
        />
      </div>
    );
  }

  if ((step === "crop" || step === "saving") && img) {
    const busy = step === "saving";
    const zoomPct = Math.round(view.zoom * 100) / 100;
    return (
      <div className={"pg-picker" + (compact ? " pg-picker-compact" : "")}>
        {alertBox}
        <div className="pg-crop">
          <div
            ref={boxRef}
            className="pg-crop-box"
            tabIndex={busy ? -1 : 0}
            role="group"
            aria-label="Crop area. Drag to move the photo, use the slider to zoom, or use the arrow keys and the plus and minus keys."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
          >
            <canvas ref={canvasRef} className="pg-crop-canvas" aria-hidden="true" />
            <span className="pg-crop-ring" aria-hidden="true" />
          </div>
          <div className="pg-crop-side">
            <label className="pg-zoom">
              <span className="pg-zoom-label">Zoom</span>
              <input
                type="range"
                min="1"
                max={maxZoom}
                step="0.01"
                value={zoomPct}
                disabled={busy || maxZoom <= 1}
                onChange={(e) => setView(PG_normView(img, { ...view, zoom: Number(e.target.value) }))}
                aria-label="Zoom"
              />
            </label>
            <div className="pg-preview-row">
              <span className="pg-preview" aria-hidden="true">
                <canvas ref={previewRef} />
              </span>
              <span className="pg-preview-text">This is how your photo will look.</span>
            </div>
            <div className="pg-actions">
              <button type="button" className="btn-primary pg-btn" onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Use this photo"}
              </button>
              <button type="button" className="btn-secondary pg-btn" onClick={reset} disabled={busy}>
                Choose another
              </button>
            </div>
            {busy && (
              <p className="pg-saving" role="status">
                Saving…
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // choose
  return (
    <div className={"pg-picker" + (compact ? " pg-picker-compact" : "")}>
      {alertBox}
      <div
        className={"pg-drop" + (over ? " pg-drop-over" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          handleFile(f);
        }}
      >
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onInput} />
        <input ref={captureRef} type="file" accept="image/*" capture="user" hidden onChange={onInput} />
        <p className="pg-drop-text">{loading ? "Opening your photo…" : "Drag a photo here, or choose one."}</p>
        <div className="pg-actions">
          <button type="button" className="btn-primary pg-btn" disabled={loading} onClick={() => fileRef.current && fileRef.current.click()}>
            Upload a photo
          </button>
          <button type="button" className="btn-secondary pg-btn" disabled={loading} onClick={onTake}>
            Take a photo
          </button>
        </div>
        <p className="pg-drop-hint">JPG, PNG or WebP, up to 15 MB.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The gate.
// ---------------------------------------------------------------------------
function PG_Gate({ staffUser, impersonating, isPreviewingUser, page, onOpenSettings, onSignOut }) {
  const st = SP_useMyStatus(staffUser && staffUser.email);
  const [, force] = React.useState(0);
  const [savedFlash, setSavedFlash] = React.useState(false);
  const titleRef = React.useRef(null);
  const rootRef = React.useRef(null);
  const data = st.data || {};
  const must = SP_mustUpload({
    loaded: st.loaded,
    error: st.error,
    status: data.status,
    active: data.status !== "none",
    impersonating: !!impersonating,
    previewing: !!isPreviewingUser,
    dismissedThisLoad: PG_dismissedThisLoad,
  });
  // Stays up for a moment after the save so "Thanks!" is seen.
  const show = (must || savedFlash) && page !== "settings";

  React.useEffect(() => {
    if (!show) return undefined;
    if (titleRef.current) titleRef.current.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [show]);

  React.useEffect(() => {
    if (!savedFlash) return undefined;
    const t = setTimeout(() => setSavedFlash(false), 1800);
    return () => clearTimeout(t);
  }, [savedFlash]);

  if (!show) return null;

  // Esc does nothing. Tab stays inside the gate.
  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key !== "Tab" || !rootRef.current) return;
    const items = [...rootRef.current.querySelectorAll('button, [href], input, select, textarea, video, [tabindex]:not([tabindex="-1"])')].filter(
      (el) => !el.disabled && el.offsetParent !== null,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const newHire = !!data.is_new_hire;
  return (
    <div id="pg-gate" className="pg-gate" role="dialog" aria-modal="true" aria-labelledby="pg-gate-title" ref={rootRef} onKeyDown={onKeyDown}>
      <header className="pg-head">
        <span className="pg-wordmark">
          My<span className="pg-wordmark-good">Good</span>Books
        </span>
        <div className="pg-head-actions">
          <button type="button" className="btn-secondary pg-head-btn" onClick={onOpenSettings}>
            Settings
          </button>
          <button type="button" className="btn-secondary pg-head-btn" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="pg-main">
        <div className="pg-card">
          <h1 id="pg-gate-title" className="pg-title" tabIndex={-1} ref={titleRef}>
            Add your profile photo
          </h1>
          <p className="pg-lead">
            {newHire
              ? "Welcome to MyGoodBooks! Clients and teammates see this photo next to your name, and in your email signature if you turn that on. It takes about a minute."
              : "We now ask everyone for a profile photo so the team looks the same everywhere clients see us. It takes about a minute, and you only do it once."}
          </p>
          <ul className="pg-guide">
            <li>A clear, recent photo of your face and shoulders</li>
            <li>Look at the camera, in good light</li>
            <li>Any background is fine: an admin removes it so every photo matches</li>
            <li>No sunglasses, hats, filters or group photos</li>
          </ul>
          <PG_PhotoPicker
            email={staffUser.email}
            onDone={() => setSavedFlash(true)}
            onSkip={() => {
              PG_dismissedThisLoad = true;
              force((n) => n + 1);
            }}
          />
        </div>
      </main>
    </div>
  );
}
