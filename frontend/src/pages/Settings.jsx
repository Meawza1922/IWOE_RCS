import { useEffect, useRef, useState } from "react";

import {
  getRcsBridgeBaseUrl,
  getRcsBridgeStatus,
  checkRcsConnection,
} from "../services/rcs";

import {
  loadPreferences,
  PREFERENCES_KEY,
} from "../utils/dashboardData";

import "../styles/OverviewSettings.css";

const initialCheck = {
  state: "idle",
  message: "Not checked",
  time: "",
};

const labels = {
  idle: "Not checked",
  checking: "Checking…",
  success: "Responded",
  error: "Check failed",
};

function CheckResult({ result }) {
  return (
    <div
      className="settings-result"
      role="status"
      aria-live="polite"
    >
      <span className={`settings-badge ${result.state}`}>
        {labels[result.state]}
      </span>

      <p>{result.message}</p>

      {result.time && (
        <small>Last checked: {result.time}</small>
      )}
    </div>
  );
}

export default function Settings() {
  const [saved, setSaved] = useState(loadPreferences);
  const [draft, setDraft] = useState(() => ({ ...saved }));
  const [notice, setNotice] = useState(null);

  const [bridge, setBridge] = useState(null);
  const [backendResult, setBackendResult] =
    useState(initialCheck);
  const [rcsResult, setRcsResult] =
    useState(initialCheck);

  const [robotCode, setRobotCode] = useState("30964");
  const [busy, setBusy] = useState("");
  const controllerRef = useRef(null);

  const dirty =
    draft.warehouseName !== saved.warehouseName ||
    draft.defaultPriority !== saved.defaultPriority;

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  function update(field, value) {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));

    setNotice(null);
  }

  function save(event) {
    event.preventDefault();

    try {
      const value = {
        warehouseName: draft.warehouseName.trim(),
        defaultPriority: Number(draft.defaultPriority),
      };

      if (!value.warehouseName) {
        throw new Error("Enter a warehouse name.");
      }

      if (
        ![30, 60, 90, 120].includes(value.defaultPriority)
      ) {
        throw new Error("Select a valid priority.");
      }

      localStorage.setItem(
        PREFERENCES_KEY,
        JSON.stringify(value)
      );

      window.dispatchEvent(
        new CustomEvent("wms-preferences-changed")
      );

      setSaved(value);
      setDraft(value);

      setNotice({
        error: false,
        text: "Preferences saved. The default priority applies to new transfer forms.",
      });
    } catch (error) {
      setNotice({
        error: true,
        text: error.message,
      });
    }
  }

  async function check(kind) {
    if (controllerRef.current) return;

    const request = new AbortController();

    const setResult =
      kind === "rcs"
        ? setRcsResult
        : setBackendResult;

    controllerRef.current = request;
    setBusy(kind);

    setResult({
      state: "checking",
      message: "Waiting for a response…",
      time: "",
    });

    if (kind === "backend") {
      setBridge(null);
    }

    const timer = window.setTimeout(
      () => request.abort(),
      35000
    );

    try {
      let message;

      if (kind === "rcs") {
        await checkRcsConnection(robotCode, {
          signal: request.signal,
        });

        message =
          `RCS responded to the query for robot ${robotCode.trim()}. ` +
          "This does not confirm that the robot is online or ready to move.";
      } else {
        const status = await getRcsBridgeStatus({
          signal: request.signal,
        });

        if (status.ok !== true) {
          throw new Error("Unexpected backend response.");
        }

        if (controllerRef.current !== request) return;

        setBridge(status);

        message =
          "Backend responded. Check RCS separately to verify its connection.";
      }

      if (controllerRef.current === request) {
        setResult({
          state: "success",
          message,
          time: new Date().toLocaleString(),
        });
      }
    } catch (error) {
      if (controllerRef.current === request) {
        setResult({
          state: "error",
          message: request.signal.aborted
            ? "Check timed out or was cancelled."
            : error.message,
          time: new Date().toLocaleString(),
        });
      }
    } finally {
      window.clearTimeout(timer);

      if (controllerRef.current === request) {
        controllerRef.current = null;
        setBusy("");
      }
    }
  }

  return (
    <div className="page wms-overview settings-page">
      <div className="page-header">
        <div>
          <span className="page-label">
            SYSTEM PREFERENCES
          </span>

          <h2>Settings</h2>

          <p>
            Manage warehouse preferences and check connections.
          </p>
        </div>
      </div>

      <div className="overview-columns">
        <section className="panel overview-section">
          <div className="overview-heading">
            <h3>Warehouse preferences</h3>

            <span
              className={`settings-badge ${
                dirty ? "pending" : "idle"
              }`}
            >
              {dirty
                ? "Unsaved changes"
                : "No pending changes"}
            </span>
          </div>

          <form className="overview-form" onSubmit={save}>
            <label>
              Warehouse name

              <input
                required
                maxLength={100}
                value={draft.warehouseName}
                onChange={(event) =>
                  update("warehouseName", event.target.value)
                }
              />
            </label>

            <label>
              Default transfer priority

              <select
                value={draft.defaultPriority}
                onChange={(event) =>
                  update(
                    "defaultPriority",
                    Number(event.target.value)
                  )
                }
              >
                <option value={30}>Low</option>
                <option value={60}>Normal</option>
                <option value={90}>High</option>
                <option value={120}>Urgent</option>
              </select>
            </label>

            <p>
              Saved in this browser. You can choose a
              different priority for each transfer in Monitor.
            </p>

            <div className="overview-actions">
              <button
                type="submit"
                className="primary-button"
                disabled={!dirty}
              >
                Save preferences
              </button>

              <button
                type="button"
                className="settings-secondary"
                disabled={!dirty}
                onClick={() => {
                  setDraft({ ...saved });
                  setNotice(null);
                }}
              >
                Discard changes
              </button>
            </div>

            {notice && (
              <p role={notice.error ? "alert" : "status"}>
                {notice.text}
              </p>
            )}
          </form>
        </section>

        <section className="panel overview-section">
          <h3>Storage information</h3>

          <dl className="overview-facts">
            <div>
              <dt>Load types</dt>
              <dd>Basket / Pallet / Rack</dd>
            </div>

            <div>
              <dt>Location capacity</dt>
              <dd>1 load per point</dd>
            </div>

            <div>
              <dt>Load contents</dt>
              <dd>Multiple products and quantities</dd>
            </div>

            <div>
              <dt>Location update</dt>
              <dd>After confirmed completion</dd>
            </div>

            <div>
              <dt>Warehouse data</dt>
              <dd>This browser</dd>
            </div>
          </dl>

          <p>
            Manage warehouse layout and load contents in
            Monitor. Keep one WMS tab open for automatic dispatch.
          </p>
        </section>
      </div>

      <div className="overview-columns">
        <section className="panel overview-section">
          <h3>Backend connection</h3>

          <p>
            Check whether the warehouse backend responds.
          </p>

          <button
            type="button"
            className="primary-button"
            disabled={Boolean(busy)}
            onClick={() => check("backend")}
          >
            {busy === "backend"
              ? "Checking backend…"
              : "Check backend"}
          </button>

          <CheckResult result={backendResult} />

          {bridge && (
            <dl className="overview-facts">
              <div>
                <dt>Mode</dt>
                <dd>{bridge.bridgeMode || "Unknown"}</dd>
              </div>

              <div>
                <dt>HIK configured</dt>
                <dd>
                  {bridge.hikConfigured ? "Yes" : "No"}
                </dd>
              </div>
            </dl>
          )}

          <details className="settings-details">
            <summary>Connection configuration</summary>

            <div className="overview-form">
              <label>
                Backend API URL

                <input
                  readOnly
                  value={getRcsBridgeBaseUrl()}
                />
              </label>
            </div>

            <p>
              The frontend environment setting
              VITE_RCS_BRIDGE_URL can override this address.
              Restart Vite after changing it. HIK server
              settings and credentials are configured in
              the backend.
            </p>

            {bridge && (
              <p>
                Task database: {bridge.database || "Unknown"}
              </p>
            )}
          </details>
        </section>

        <section className="panel overview-section">
          <h3>RCS connection</h3>

          <p>
            Check the RCS response using a robot query.
            This check does not submit a movement task.
          </p>

          <div className="overview-form">
            <label>
              Robot code

              <input
                value={robotCode}
                disabled={Boolean(busy)}
                onChange={(event) => {
                  setRobotCode(event.target.value);
                  setRcsResult(initialCheck);
                }}
              />
            </label>

            <button
              type="button"
              className="primary-button"
              disabled={Boolean(busy) || !robotCode.trim()}
              onClick={() => check("rcs")}
            >
              {busy === "rcs"
                ? "Checking RCS…"
                : "Check RCS connection"}
            </button>
          </div>

          <CheckResult result={rcsResult} />
        </section>
      </div>
    </div>
  );
}