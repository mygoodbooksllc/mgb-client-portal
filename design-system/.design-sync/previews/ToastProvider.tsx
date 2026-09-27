import React, { useEffect } from 'react';
import { ToastProvider, useToast, Button } from 'mygoodbooks-ds';

function ReferralToastTrigger() {
  const showToast = useToast();
  useEffect(() => {
    showToast('Thanks! Your bookkeeper will follow up about upgrading.');
  }, []);
  return (
    <div style={{ padding: 20 }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        Pro plan upsell — the toast confirms the click.
      </p>
      <Button variant="primary" style={{ marginTop: 10 }}>
        Upgrade to Pro
      </Button>
    </div>
  );
}

export const WithToast = () => (
  <ToastProvider>
    <ReferralToastTrigger />
  </ToastProvider>
);
