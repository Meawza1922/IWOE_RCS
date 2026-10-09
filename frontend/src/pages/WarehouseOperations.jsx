import {
  useEffect,
  useState,
} from "react";

import { Link } from "react-router-dom";

import {
  readOperationsSnapshot,
  updateOutbound,
} from "../utils/warehouseOperations";

import "../styles/OverviewSettings.css";

export default function WarehouseOperations() {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState("OUTBOUND");
  const [search, setSearch] = useState("");

  function refresh() {
    try {
      setSnapshot(readOperationsSnapshot());
      setError("");
    } catch (error) {
      setError(error.message);
    }
  }

  useEffect(() => {
    refresh();

    const events = [
      "focus",
      "storage",
      "wms-monitor-data-changed",
      "wms-data-changed",
    ];

    events.forEach((event) => {
      window.addEventListener(event, refresh);
    });

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, refresh);
      });
    };
  }, []);

  function act(operation, action) {
    if (
      action === "COMPLETE" &&
      !window.confirm(
        `Confirm that ${operation.quantity} ${operation.unit} of ${operation.sku} has actually been picked? This deducts stock.`,
      )
    ) {
      return;
    }

    try {
      updateOutbound(operation.id, action);

      setMessage(
        action === "COMPLETE"
          ? "Picking confirmed. Stock and reservation reduced."
          : action === "CANCEL"
            ? "Cancelled. Reserved stock released; quantity unchanged."
            : "Picking started. Quantity unchanged.",
      );
    } catch (error) {
      setMessage(error.message);
    }
  }

  const history = snapshot?.monitor.history || [];

  const outbound =
    snapshot?.monitor.outboundOperations || [];

  const rows = (
    tab === "OUTBOUND"
      ? outbound
      : history.filter((record) => record.type === tab)
  )
    .filter((record) =>
      [
        record.id,
        record.sku,
        record.itemName,
        record.locationCode,
        record.basketId,
        record.reference,
        record.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .slice()
    .sort(
      (a, b) =>
        (Date.parse(b.createdAt) || 0) -
        (Date.parse(a.createdAt) || 0),
    );

  const legacyReservations = history.filter(
    (record) =>
      record.type === "OUTBOUND" &&
      !record.operationId,
  );

  const hasLegacyRecords =
    legacyReservations.length > 0 ||
    snapshot?.legacyInbound.length > 0 ||
    snapshot?.legacyOutbound.length > 0;

  return (
    <div className="page wms-overview">
      <div className="page-header">
        <div>
          <span className="page-label">
            WAREHOUSE OPERATIONS
          </span>

          <h2>Warehouse Operations</h2>

          <p>
            Create stock operations from Monitor.
            Manage picking and review stock history here.
          </p>
        </div>
      </div>

      <section className="panel overview-section">
        <div className="overview-actions">
          <Link to="/warehouse">
            Open Monitor
          </Link>

          <Link to="/tasks">
            Task overview
          </Link>

          <button
            type="button"
            onClick={refresh}
          >
            Refresh
          </button>
        </div>

        <p>
          Inbound adds contents to a load.
          Outbound reserves stock until picking is confirmed.
          Deduct Stock is a direct adjustment.
        </p>

        {error && (
          <p role="alert">{error}</p>
        )}

        {message && (
          <p role="status">{message}</p>
        )}
      </section>

      <section className="panel overview-section">
        <div className="overview-actions">
          {[
            ["OUTBOUND", "Outbound picking"],
            ["INBOUND", "Inbound history"],
            ["DEDUCT_STOCK", "Deduction history"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="primary-button"
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="overview-search">
          Search

          <input
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
            placeholder="SKU, load, location or reference"
          />
        </label>

        <div className="table-wrapper">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Operation / created</th>
                <th>Location / load</th>
                <th>Product</th>
                <th>Quantity</th>
                <th>Status</th>

                {tab === "OUTBOUND" && (
                  <th>Action</th>
                )}
              </tr>
            </thead>

            <tbody>
              {!rows.length && (
                <tr>
                  <td colSpan={tab === "OUTBOUND" ? 6 : 5}>
                    No records.
                  </td>
                </tr>
              )}

              {rows.map((record) => (
                <tr key={record.id}>
                  <td>
                    {record.id}
                    <br />
                    {new Date(
                      record.createdAt,
                    ).toLocaleString()}
                  </td>

                  <td>
                    {record.locationCode}
                    <br />
                    {record.basketId || "—"}
                  </td>

                  <td>
                    {record.sku}
                    <br />
                    {record.itemName}
                  </td>

                  <td>
                    {record.quantity} {record.unit}
                  </td>

                  <td>
                    {record.status || "RECORDED"}
                  </td>

                  {tab === "OUTBOUND" && (
                    <td>
                      {record.status === "PENDING" && (
                        <button
                          type="button"
                          disabled={!!error}
                          onClick={() =>
                            act(record, "START")
                          }
                        >
                          Start picking
                        </button>
                      )}

                      {record.status === "IN_PROGRESS" && (
                        <button
                          type="button"
                          disabled={!!error}
                          onClick={() =>
                            act(record, "COMPLETE")
                          }
                        >
                          Confirm picked
                        </button>
                      )}

                      {[
                        "PENDING",
                        "IN_PROGRESS",
                      ].includes(record.status) && (
                        <button
                          type="button"
                          disabled={!!error}
                          onClick={() =>
                            act(record, "CANCEL")
                          }
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {hasLegacyRecords && (
        <section className="panel overview-section">
          <details>
            <summary>
              Previous-version records — review only
            </summary>

            <p>
              These records are preserved separately.
              Their stock reservations are not automatically
              converted or released.
            </p>

            {[
              ...legacyReservations,
              ...(snapshot?.legacyInbound || []),
              ...(snapshot?.legacyOutbound || []),
            ].map((record, index) => (
              <p key={index}>
                {record.id || record.orderNo}
                {" · "}
                {record.sku || record.type || "Legacy order"}
                {" · "}
                {record.locationCode || ""}
                {" · "}
                {record.quantity ?? ""}
                {" · "}
                {record.status || "REVIEW REQUIRED"}
              </p>
            ))}
          </details>
        </section>
      )}
    </div>
  );
}