import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Boxes,
  Layers3,
  MapPin,
  Package,
  Search,
  Warehouse,
} from "lucide-react";

import {
  readMonitor,
  shelvesOf,
} from "../utils/basketStore";

import "../styles/WarehouseData.css";

export default function WarehouseData() {
  const navigate = useNavigate();

  const [data, setData] = useState(() => {
    try {
      return readMonitor();
    } catch {
      return {
        racks: [],
        skuCatalog: [],
      };
    }
  });

  const [activeTab, setActiveTab] = useState("INVENTORY");
  const [search, setSearch] = useState("");
  const [loadTypeFilter, setLoadTypeFilter] = useState("ALL");

  const locations = useMemo(
    () =>
      shelvesOf(data).map((shelf) => ({
        ...shelf,
        capacity: 1,
        used: shelf.basket ? 1 : 0,
      })),
    [data]
  );

  const inventory = useMemo(
    () =>
      locations.flatMap((shelf) =>
        shelf.inventory.map((item) => ({
          ...item,
          locationId: shelf.id,
          basketId: shelf.basket?.id,
        }))
      ),
    [locations]
  );

  const skuMasters = data.skuCatalog || [];

  useEffect(() => {
    function refresh() {
      try {
        setData(readMonitor());
      } catch {
        // Preserve the last valid view.
      }
    }

    const events = [
      "focus",
      "storage",
      "wms-monitor-data-changed",
    ];

    events.forEach((eventName) => {
      window.addEventListener(eventName, refresh);
    });

    return () => {
      events.forEach((eventName) => {
        window.removeEventListener(eventName, refresh);
      });
    };
  }, []);

  const locationMap = useMemo(
    () =>
      new Map(
        locations.map((location) => [
          String(location.id),
          location,
        ])
      ),
    [locations]
  );

  const inventoryRows = useMemo(() => {
    const masterMap = new Map(
      skuMasters.map((master) => [
        String(master.sku || "").toUpperCase(),
        master,
      ])
    );

    inventory.forEach((record) => {
      const sku = String(record.sku || "")
        .trim()
        .toUpperCase();

      if (!sku || masterMap.has(sku)) {
        return;
      }

      masterMap.set(sku, {
        sku,
        name: record.name || "Unknown Item",
        category: record.category || "General",
        unit: record.unit || "PCS",
        minStock: Number(record.minStock || 0),
        maxStock: Number(record.maxStock || 0),
      });
    });

    return Array.from(masterMap.values())
      .map((master) => {
        const sku = String(master.sku || "")
          .trim()
          .toUpperCase();

        const records = inventory.filter(
          (record) =>
            String(record.sku || "")
              .trim()
              .toUpperCase() === sku
        );

        const totalQuantity = records.reduce(
          (sum, record) =>
            sum + Number(record.quantity || 0),
          0
        );

        const usedLocationIds = Array.from(
          new Set(
            records
              .map((record) =>
                String(record.locationId || "")
              )
              .filter(Boolean)
          )
        );

        const usedLocations = usedLocationIds.map(
          (id) =>
            locationMap.get(id) || {
              id,
              code: id,
            }
        );

        return {
          ...master,
          sku,
          totalQuantity,
          usedLocations,
          status: getStockStatus(
            totalQuantity,
            Number(master.minStock || 0)
          ),
        };
      })
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }, [inventory, locationMap, skuMasters]);

  const locationRows = useMemo(() => {
    return locations
      .map((location) => {
        const stock = inventory.filter(
          (record) =>
            String(record.locationId || "") ===
            String(location.id || "")
        );

        const quantity = stock.reduce(
          (sum, record) =>
            sum + Number(record.quantity || 0),
          0
        );

        return {
          ...location,
          stock,
          quantity,
        };
      })
      .sort((a, b) =>
        [
          a.zone,
          a.rack,
          Number(a.level || 0),
          a.code,
        ]
          .join("|")
          .localeCompare(
            [
              b.zone,
              b.rack,
              Number(b.level || 0),
              b.code,
            ].join("|"),
            undefined,
            { numeric: true }
          )
      );
  }, [inventory, locations]);

  const filteredInventoryRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    return inventoryRows.filter((row) => {
      const matchesType =
        loadTypeFilter === "ALL" ||
        row.usedLocations.some(
          (location) =>
            location.loadType === loadTypeFilter
        );

      const matchesSearch = [
        row.sku,
        row.name,
        row.category,
        row.unit,
        row.status,
        ...row.usedLocations.flatMap((location) => [
          location.code,
          location.zone,
          location.rack,
          location.level,
          location.loadType,
          location.basket?.id,
        ]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);

      return matchesType && matchesSearch;
    });
  }, [inventoryRows, search, loadTypeFilter]);

  const filteredLocationRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    return locationRows.filter((row) => {
      const matchesType =
        loadTypeFilter === "ALL" ||
        row.loadType === loadTypeFilter;

      const matchesSearch = [
        row.id,
        row.code,
        row.zone,
        row.rack,
        row.level,
        row.status,
        row.loadType,
        row.basket?.id,
        ...row.stock.flatMap((record) => [
          record.sku,
          record.name,
        ]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);

      return matchesType && matchesSearch;
    });
  }, [locationRows, search, loadTypeFilter]);

  const summary = useMemo(() => {
    const totalQuantity = inventory.reduce(
      (sum, record) =>
        sum + Number(record.quantity || 0),
      0
    );

    const rackKeys = new Set(
      locations.map((location) =>
        [
          location.warehouse || "WH-01",
          location.zone || "ZONE",
          location.rack || "RACK",
        ].join("|")
      )
    );

    const occupiedShelves = locationRows.filter(
      (row) => Boolean(row.basket)
    ).length;

    return {
      skuCount: inventoryRows.length,
      totalQuantity,
      rackCount: rackKeys.size,
      shelfCount: locations.length,
      occupiedShelves,
    };
  }, [
    inventory,
    inventoryRows.length,
    locationRows,
    locations,
  ]);

  return (
    <div className="warehouse-data-page">
      <div className="warehouse-data-header">
        <div>
          <span className="warehouse-data-label">
            WAREHOUSE DATA VIEW
          </span>

          <div className="warehouse-data-title-row">
            <h2>Inventory &amp; Storage Data</h2>

            <span className="warehouse-data-readonly-badge">
              READ ONLY
            </span>
          </div>

          <p>
            Read-only operational data generated from
            Warehouse Monitor. Storage, load and stock
            changes are managed from the Warehouse
            Monitor page.
          </p>
        </div>

        <button
          type="button"
          className="warehouse-data-monitor-button"
          onClick={() => navigate("/warehouse")}
        >
          <MapPin size={17} />
          Open Warehouse Monitor
        </button>
      </div>

      <div className="warehouse-data-source-note">
        <Warehouse size={18} />

        <div>
          <strong>
            Warehouse Monitor is the main source of
            warehouse data.
          </strong>

          <span>
            This page does not create, move, edit or
            deduct stock. It only shows the latest
            storage, load, SKU and quantity information
            from Monitor.
          </span>
        </div>
      </div>

      <div className="warehouse-data-summary-grid">
        <SummaryCard
          icon={<Package size={20} />}
          title="Catalog SKUs"
          value={summary.skuCount}
        />

        <SummaryCard
          icon={<Boxes size={20} />}
          title="Total Quantity"
          value={summary.totalQuantity}
        />

        <SummaryCard
          icon={<Warehouse size={20} />}
          title="Storage Groups"
          value={summary.rackCount}
        />

        <SummaryCard
          icon={<Layers3 size={20} />}
          title="Storage Points"
          value={summary.shelfCount}
        />

        <SummaryCard
          icon={<MapPin size={20} />}
          title="Occupied Points"
          value={summary.occupiedShelves}
        />
      </div>

      <section className="warehouse-data-panel">
        <div className="warehouse-data-panel-header">
          <div className="warehouse-data-tabs">
            <button
              type="button"
              className={
                activeTab === "INVENTORY" ? "active" : ""
              }
              onClick={() => {
                setActiveTab("INVENTORY");
                setSearch("");
              }}
            >
              Inventory Data
            </button>

            <button
              type="button"
              className={
                activeTab === "LOCATIONS" ? "active" : ""
              }
              onClick={() => {
                setActiveTab("LOCATIONS");
                setSearch("");
              }}
            >
              Storage Location Data
            </button>
          </div>

          <div className="warehouse-data-search">
            <Search size={17} />

            <input
              type="text"
              aria-label="Search warehouse data"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder={
                activeTab === "INVENTORY"
                  ? "Search SKU, item, load or location..."
                  : "Search location, load or SKU..."
              }
            />
          </div>
        </div>

        <div className="warehouse-data-filter-bar">
          <label>
            Load type

            <select
              value={loadTypeFilter}
              onChange={(event) =>
                setLoadTypeFilter(event.target.value)
              }
            >
              <option value="ALL">All types</option>
              <option value="BASKET">Basket</option>
              <option value="PALLET">Pallet</option>
              <option value="RACK">Rack</option>
            </select>
          </label>

          <span role="status">
            Showing{" "}
            {activeTab === "INVENTORY"
              ? filteredInventoryRows.length
              : filteredLocationRows.length}
            {" of "}
            {activeTab === "INVENTORY"
              ? inventoryRows.length
              : locationRows.length}
            {activeTab === "INVENTORY"
              ? " SKUs"
              : " locations"}
          </span>

          <button
            type="button"
            disabled={
              !search && loadTypeFilter === "ALL"
            }
            onClick={() => {
              setSearch("");
              setLoadTypeFilter("ALL");
            }}
          >
            Clear filters
          </button>
        </div>

        <p className="warehouse-data-filter-note">
          Summary cards show the whole warehouse.
          {activeTab === "INVENTORY" &&
            " The type filter selects SKUs stored in that load type. Quantities, locations and stock status remain warehouse totals. SKUs without a location appear under All types."}
        </p>

        {activeTab === "INVENTORY" ? (
          <InventoryTable rows={filteredInventoryRows} />
        ) : (
          <LocationTable rows={filteredLocationRows} />
        )}
      </section>
    </div>
  );
}

function SummaryCard({ icon, title, value }) {
  return (
    <div className="warehouse-data-summary-card">
      <div className="warehouse-data-summary-icon">
        {icon}
      </div>

      <div>
        <span>{title}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function InventoryTable({ rows }) {
  return (
    <div className="warehouse-data-table-wrapper">
      <table className="warehouse-data-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Item</th>
            <th>Category</th>
            <th>Total Qty</th>
            <th>Unit</th>
            <th>Load Types</th>
            <th>Storage Locations</th>
            <th>Status</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={row.sku}>
              <td>
                <strong>{row.sku}</strong>
              </td>

              <td>{row.name || "-"}</td>
              <td>{row.category || "-"}</td>

              <td>
                <strong>{row.totalQuantity}</strong>
              </td>

              <td>{row.unit || "PCS"}</td>

              <td>
                <div className="warehouse-data-type-list">
                  {[
                    ...new Set(
                      row.usedLocations
                        .map(
                          (location) => location.loadType
                        )
                        .filter(Boolean)
                    ),
                  ].map((type) => (
                    <LoadTypeBadge
                      key={type}
                      type={type}
                    />
                  ))}

                  {row.usedLocations.length === 0 && "—"}
                </div>
              </td>

              <td>
                <div className="warehouse-data-location-tags">
                  {row.usedLocations.length > 0 ? (
                    row.usedLocations.map((location) => (
                      <span
                        key={location.id || location.code}
                      >
                        {location.code || location.id}
                      </span>
                    ))
                  ) : (
                    <span className="empty">
                      No stock location
                    </span>
                  )}
                </div>
              </td>

              <td>
                <span
                  className={
                    "warehouse-data-status " +
                    row.status
                      .toLowerCase()
                      .replaceAll(" ", "-")
                  }
                >
                  {row.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length === 0 && (
        <div className="warehouse-data-empty">
          No inventory records found.
        </div>
      )}
    </div>
  );
}

function LocationTable({ rows }) {
  return (
    <div className="warehouse-data-table-wrapper">
      <table className="warehouse-data-table">
        <thead>
          <tr>
            <th>Location</th>
            <th>Zone / Storage</th>
            <th>Load Type</th>
            <th>Level</th>
            <th>Inventory</th>
            <th>Qty</th>
            <th>Load / Capacity</th>
            <th>Status</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => {
            const capacity = Number(row.capacity || 0);
            const used = row.basket ? 1 : 0;

            const percent =
              capacity > 0
                ? Math.max(
                    0,
                    Math.min(
                      100,
                      Math.round((used / capacity) * 100)
                    )
                  )
                : 0;

            return (
              <tr key={row.id || row.code}>
                <td>
                  <div className="warehouse-data-main-cell">
                    <strong>{row.code || row.id}</strong>
                    <span>{row.id || "-"}</span>
                  </div>
                </td>

                <td>
                  <div className="warehouse-data-main-cell">
                    <strong>{row.zone || "-"}</strong>
                    <span>{row.rack || "-"}</span>
                  </div>
                </td>

                <td>
                  <LoadTypeBadge type={row.loadType} />
                </td>

                <td>
                  {row.loadType === "RACK"
                    ? "—"
                    : row.level || "—"}
                </td>

                <td>
                  <div className="warehouse-data-stock-list">
                    {row.stock.length > 0 ? (
                      row.stock.map((record) => (
                        <span
                          key={
                            record.id ||
                            `${record.sku}-${row.id}`
                          }
                        >
                          <strong>{record.sku}</strong>

                          {record.name
                            ? ` · ${record.name}`
                            : ""}
                        </span>
                      ))
                    ) : (
                      <span className="empty">
                        Empty
                      </span>
                    )}
                  </div>
                </td>

                <td>
                  <strong>{row.quantity}</strong>
                </td>

                <td>
                  <div className="warehouse-data-capacity">
                    <div>
                      <span>
                        {row.basket?.id || "No load"}
                        {" · "}
                        {used}
                      </span>

                      <span>{capacity || "-"}</span>
                    </div>

                    <div className="warehouse-data-capacity-track">
                      <div
                        style={{
                          width: `${percent}%`,
                        }}
                      />
                    </div>
                  </div>
                </td>

                <td>
                  <span
                    className={
                      "warehouse-data-status " +
                      String(
                        row.status || "AVAILABLE"
                      ).toLowerCase()
                    }
                  >
                    {row.status || "AVAILABLE"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {rows.length === 0 && (
        <div className="warehouse-data-empty">
          No storage locations found.
        </div>
      )}
    </div>
  );
}

function getStockStatus(quantity, minStock) {
  if (quantity <= 0) {
    return "Out of Stock";
  }

  if (minStock > 0 && quantity <= minStock) {
    return "Low Stock";
  }

  return "In Stock";
}

function LoadTypeBadge({ type }) {
  const names = {
    BASKET: "Basket",
    PALLET: "Pallet",
    RACK: "Rack",
  };

  return (
    <span
      className={`warehouse-data-type ${String(
        type || "unknown"
      ).toLowerCase()}`}
    >
      {names[type] || "Unknown"}
    </span>
  );
}