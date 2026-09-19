import { useState } from "react";
import { useClerk } from "@clerk/clerk-react";
import { deleteAccount, exportAccountData } from "../api/client";
import { useAppUser } from "../hooks/useAppUser";

// Triggers a browser download of a JSON blob — no server round trip beyond
// the one that already fetched the data.
function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SettingsPage() {
  const { user } = useAppUser();
  const { signOut } = useClerk();
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [confirmText, setConfirmText] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function onExport() {
    setExportBusy(true);
    setExportError(null);
    try {
      const data = await exportAccountData();
      downloadJson(`interviewai-data-${new Date().toISOString().slice(0, 10)}.json`, data);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportBusy(false);
    }
  }

  async function onDelete() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteAccount();
      await signOut({ redirectUrl: "/" });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setDeleteBusy(false);
    }
  }

  const canDelete = confirmText.trim().toUpperCase() === "DELETE";

  return (
    <div className="card">
      <h1>Settings</h1>
      {user && (
        <p className="muted">
          Signed in as {user.name ? `${user.name} — ` : ""}
          {user.email}
        </p>
      )}

      <section className="settings-section">
        <h2 className="settings-section-title">Your data</h2>
        <p className="muted">
          Download everything this app has stored about you — your profile, every session
          (questions, answers, and grading), and your subscription history — as a JSON file.
        </p>
        <button type="button" className="secondary" onClick={onExport} disabled={exportBusy}>
          {exportBusy ? "Preparing download…" : "Download my data"}
        </button>
        {exportError && <p className="error">{exportError}</p>}
      </section>

      <section className="settings-section danger-zone">
        <h2 className="settings-section-title">Delete account</h2>
        <p className="muted">
          Permanently deletes your account: every session, response, and grading result, your
          subscription (cancelled first, so you stop being billed), and your sign-in identity.
          This can't be undone.
        </p>
        <label className="settings-confirm-label" htmlFor="delete-confirm">
          Type <strong>DELETE</strong> to confirm
        </label>
        <input
          id="delete-confirm"
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          autoComplete="off"
          disabled={deleteBusy}
        />
        <button type="button" className="danger" onClick={onDelete} disabled={!canDelete || deleteBusy}>
          {deleteBusy ? "Deleting…" : "Permanently delete my account"}
        </button>
        {deleteError && <p className="error">{deleteError}</p>}
      </section>
    </div>
  );
}
