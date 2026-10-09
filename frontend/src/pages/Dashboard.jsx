import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { MONITOR_KEY } from "../utils/basketStore";

import {
  loadPreferences,
  summarizeWarehouse,
} from "../utils/dashboardData";

import "../styles/OverviewSettings.css";

function readSnapshot() {
  try {
    const monitor = JSON.parse(
      localStorage.getItem(MONITOR_KEY) || "null"
    );

    const queue = JSON.parse(
      localStorage.getItem("wms-robot-tasks-v1") || "[]"
    );

    if (
      !Array.isArray(queue) ||
      (monitor && !Array.isArray(monitor.racks))
    ) {
      throw new Error("Invalid warehouse data.");
    }

    return {
      summary: summarizeWarehouse(monitor, queue),
      initialized: Boolean(monitor),
      preferences: loadPreferences(),
      error: "",
    };
  } catch (error) {
    return {
      summary: summarizeWarehouse(null, []),
      initialized: false,
      preferences: loadPreferences(),
      error: error.message,
    };
  }
}

export default function Dashboard() {
  const [loadFilter, setLoadFilter] = useState("ALL");
  const [snapshot, setSnapshot] = useState(readSnapshot);

  useEffect(() => {
    function refresh() {
      setSnapshot(readSnapshot());
    }

    const events = [
      "storage",
      "focus",
      "wms-data-changed",
      "wms-monitor-data-changed",
      "wms-preferences-changed",
    ];

    events.forEach((eventName) => {
      window.addEventListener(eventName, refresh);
    });

    const timer = window.setInterval(refresh, 1000);

    return () => {
      window.clearInterval(timer);

      events.forEach((eventName) => {
        window.removeEventListener(eventName, refresh);
      });
    };
  }, []);

  const {
    summary,
    preferences,
    error,
    initialized,
  } = snapshot;

  const cards = [
    ["Total loads", summary.loads],
    ["Baskets", summary.loadsByType.BASKET],
    ["Pallets", summary.loadsByType.PALLET],
    ["Rack loads", summary.loadsByType.RACK],
    [
      "Occupied points",
      `${summary.loads} / ${summary.shelves}`,
    ],
    ["Empty available points", summary.empty],
    ["SKU types in stock", summary.skuCount],
    ["Total item quantity", summary.quantity],
  ];

  const queueSummary = [
    ["Pending total", summary.pending],
    ["Ready by schedule", summary.ready],
    ["Scheduled for later", summary.scheduled],
    ["Submitted / running", summary.active],
    ["Completed", summary.completed],
    ["Needs attention", summary.attention],
  ];

  const visibleStorage = summary.occupancy.filter(
    (rack) =>
      loadFilter === "ALL" ||
      rack.type === loadFilter
  );

  return (
    <div className="page wms-overview load-dashboard">
      <div className="page-header">
        <div>
          <span className="page-label">
            WAREHOUSE OVERVIEW
          </span>

          <h2>Dashboard</h2>

          <p>
            {preferences.warehouseName}
            {" · "}
            Storage, inventory and transfer activity.
          </p>
        </div>
      </div>

      {error ? (
        <p role="alert">
          Cannot read warehouse data: {error}
        </p>
      ) : (
        <>
          {!initialized && (
            <p className="overview-notice">
              Open{" "}
              <Link to="/warehouse">
                Warehouse Monitor
              </Link>{" "}
              to initialize the warehouse layout.
            </p>
          )}

          <div className="overview-stats">
            {cards.map(([name, value]) => (
              <section
                className="panel overview-stat"
                key={name}
              >
                <span>{name}</span>
                <strong>{value}</strong>
              </section>
            ))}
          </div>

          <div className="overview-columns">
            <section className="panel overview-section">
              <div className="overview-heading">
                <h3>
                  Storage occupancy ·{" "}
                  {summary.utilization}%
                </h3>

                <Link to="/warehouse">
                  Open Monitor
                </Link>
              </div>

              <p>
                Each point holds one load: a basket,
                pallet or rack. Loads without stock
                also occupy a point.
              </p>

              <div
                className="dashboard-filters"
                aria-label="Filter storage by load type"
              >
                {[
                  ["ALL", "All types"],
                  ["BASKET", "Basket"],
                  ["PALLET", "Pallet"],
                  ["RACK", "Rack"],
                ].map(([type, label]) => (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={loadFilter === type}
                    onClick={() => setLoadFilter(type)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <p>
                {summary.empty} available
                {" · "}
                {summary.reserved} reserved
                {" · "}
                {summary.blocked} blocked / maintenance
              </p>

              <p>
                Reserved points may also be occupied
                or blocked.
              </p>

              {visibleStorage.length === 0 && (
                <p>
                  No storage points for this load type.
                </p>
              )}

              <div
                className="dashboard-storage-list"
                role="region"
                aria-label="Storage occupancy list"
                tabIndex={0}
              >
                {visibleStorage.map((rack) => (
                  <div
                    className="overview-rack"
                    key={rack.id}
                    data-load-type={rack.type}
                  >
                    <div>
                      <strong>
                        {rack.name || rack.id}

                        <small className="dashboard-type">
                          {rack.type}
                        </small>
                      </strong>

                      <span>
                        {rack.occupied}
                        {" / "}
                        {rack.total}
                        {" occupied points"}
                      </span>
                    </div>

                    <progress
                      value={rack.occupied}
                      max={rack.total || 1}
                      aria-label={`${rack.id} load occupancy`}
                    />

                    <small>
                      {rack.available} available
                      {" · "}
                      {rack.reserved} reserved
                      {" · "}
                      {rack.blocked} blocked
                    </small>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel overview-section">
              <div className="overview-heading">
                <h3>Dispatch summary</h3>

                <Link to="/dispatcher">
                  Manage queue
                </Link>
              </div>

              <dl className="overview-facts">
                {queueSummary.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>

              <p>
                Eligible urgent tasks follow the active
                task. Equal priority follows FIFO.
              </p>

              <Link to="/warehouse-data">
                View load contents and inventory
              </Link>
            </section>
          </div>

          <section className="panel overview-section">
            <div className="overview-heading">
              <h3>Recent transfers</h3>

              <Link to="/dispatcher">
                View all
              </Link>
            </div>

            <div className="table-wrapper">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Load ID</th>
                    <th>Route</th>
                    <th>Priority</th>
                    <th>Scheduled time</th>
                    <th>Status</th>
                  </tr>
                </thead>

                <tbody>
                  {summary.recent.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        No queued transfers yet.
                        Create a load transfer from Monitor.
                      </td>
                    </tr>
                  )}

                  {summary.recent.map((task) => (
                    <tr key={task.id}>
                      <td>{task.id}</td>

                      <td>
                        {task.basketId || "—"}
                      </td>

                      <td>
                        {task.sourceRcsPointCode || "—"}
                        {" → "}
                        {task.destinationRcsPointCode || "—"}
                      </td>

                      <td>
                        {task.wmsPriority || task.rcsPriority}
                      </td>

                      <td>
                        {task.scheduledSendAt &&
                        Number.isFinite(
                          Date.parse(task.scheduledSendAt)
                        )
                          ? new Date(
                              task.scheduledSendAt
                            ).toLocaleString()
                          : "As soon as ready"}
                      </td>

                      <td>
                        {task.backendError ||
                        task.statusCheckError ||
                        task.warehouseSyncError
                          ? "Needs attention"
                          : task.sendStatus === "SENT"
                            ? task.rcsStatus
                            : task.sendStatus}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}