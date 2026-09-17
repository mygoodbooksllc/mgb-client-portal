import React from "react";
/** One entry in {@link IconGallery}'s grid. */
export interface IconGalleryEntry {
    name: string;
    Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}
/**
 * Every icon in the house style (thin-line, `stroke="currentColor"`, no
 * emoji), in the order they were introduced across the app. Kept here
 * rather than derived from the barrel export so the gallery's order and
 * labels stay stable even if index.ts's export order changes.
 */
export declare const ICON_GALLERY_ENTRIES: IconGalleryEntry[];
/**
 * Every icon in the design system, laid out in a grid with its component
 * name underneath — a reference sheet for browsing what's available before
 * reaching for a new one. Reads its own tokens from styles.css (`--navy`,
 * `--gold`, `--surface`, `--border`), so it renders correctly wherever this
 * package's stylesheet is loaded, independent of the parent app.
 */
export declare function IconGallery(): React.JSX.Element;
