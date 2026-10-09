export const MONITOR_KEY = "wms-monitor-master-v2";

const QUEUE_KEY = "wms-robot-tasks-v1";

const STOPPED_TRANSFER_STATUSES = [
  "FAILED",
  "CANCELLED",
  "CANCELED",
];

function inventoryOf(shelf) {
  const inventory = shelf?.inventory;

  if (inventory == null) {
    return [];
  }

  if (!Array.isArray(inventory)) {
    throw new Error(
      "Invalid inventory data. Check Warehouse Monitor.",
    );
  }

  return inventory;
}

function readQueue() {
  const queue = JSON.parse(
    localStorage.getItem(QUEUE_KEY) || "[]",
  );

  if (
    !Array.isArray(queue) ||
    queue.some(
      (task) =>
        !task ||
        typeof task !== "object" ||
        Array.isArray(task),
    )
  ) {
    throw new Error(
      "Invalid queue data. Check the dispatch queue before continuing.",
    );
  }

  return queue;
}

function findLocation(shelves, id) {
  const matches = shelves.filter(
    (shelf) => shelf.id === id,
  );

  if (matches.length > 1) {
    throw new Error(
      "Duplicate location IDs found. Check Warehouse Monitor.",
    );
  }

  return matches[0];
}

export function basketOf(shelf) {
  return (
    shelf?.basket ||
    (
      inventoryOf(shelf).length
        ? { id: `BASKET-${shelf.id}` }
        : null
    )
  );
}

export function readMonitor() {
  const data = JSON.parse(
    localStorage.getItem(MONITOR_KEY) || "null",
  );

  if (!Array.isArray(data?.racks)) {
    throw new Error("Open Warehouse Monitor first.");
  }

  for (const rack of data.racks) {
    if (
      !rack ||
      !Array.isArray(rack.shelves) ||
      rack.shelves.some(
        (shelf) =>
          !shelf ||
          typeof shelf !== "object" ||
          Array.isArray(shelf),
      )
    ) {
      throw new Error(
        "Invalid storage data. Check Warehouse Monitor.",
      );
    }
  }

  return data;
}

export function shelvesOf(data) {
  return data.racks.flatMap((rack) =>
    rack.shelves.map((shelf) => ({
      ...shelf,
      rack: rack.id,
      loadType: rack.loadType || "BASKET",
      inventory: inventoryOf(shelf),
      basket: basketOf(shelf),
    })),
  );
}

// Reserve both depths on the same rack level.
function laneIds(locations, id) {
  const point = findLocation(locations, id);

  if (!point) {
    return [id];
  }

  const level = Number(point.level);

  if (!Number.isInteger(level) || level < 1) {
    return [id];
  }

  return locations
    .filter(
      (item) =>
        item.rack === point.rack &&
        Number(item.level) === level,
    )
    .map((item) => item.id);
}

export function isStoppedTransferReviewed(
  task,
  data = readMonitor(),
) {
  if (
    !task ||
    task.sendStatus !== "SENT" ||
    !STOPPED_TRANSFER_STATUSES.includes(task.rcsStatus)
  ) {
    return false;
  }

  const review = data.reviewedStoppedTransfers?.[task.id];

  return Boolean(
    review &&
    review.resolution === "LOAD_AT_SOURCE" &&
    review.rcsStatus === task.rcsStatus &&
    review.bridgeTaskId === task.bridgeTaskId &&
    review.rcsTaskChainCode === task.rcsTaskChainCode &&
    review.basketId === task.basketId &&
    review.sourceLocationId === task.sourceLocationId &&
    review.destinationLocationId === task.destinationLocationId &&
    review.reviewedBy &&
    review.note &&
    review.reviewedAt
  );
}

export function reviewStoppedTransferAtSource(
  taskId,
  {
    reviewedBy = "",
    note = "",
    confirmedRcsStopped = false,
    confirmedLoadAtSource = false,
  } = {},
) {
  const matches = readQueue().filter(
    (task) => task.id === taskId,
  );

  if (matches.length !== 1) {
    throw new Error("Task is missing or duplicated.");
  }

  const task = matches[0];

  if (
    task.sendStatus !== "SENT" ||
    !STOPPED_TRANSFER_STATUSES.includes(task.rcsStatus) ||
    !task.bridgeTaskId ||
    !task.rcsTaskChainCode ||
    !task.basketId
  ) {
    throw new Error(
      "Only confirmed FAILED or CANCELLED transfers can be reviewed here.",
    );
  }

  const reviewer = String(reviewedBy).trim();
  const reason = String(note).trim();

  if (!reviewer || !reason) {
    throw new Error(
      "Enter the reviewer name and review notes.",
    );
  }

  if (
    confirmedRcsStopped !== true ||
    confirmedLoadAtSource !== true
  ) {
    throw new Error(
      "Confirm that the RCS task has stopped and the physical load is at the source.",
    );
  }

  const data = readMonitor();

  // Repeated confirmation does not create another history entry.
  if (isStoppedTransferReviewed(task, data)) {
    return data.reviewedStoppedTransfers[task.id];
  }

  const locations = shelvesOf(data);

  const from = findLocation(
    locations,
    task.sourceLocationId,
  );

  const to = findLocation(
    locations,
    task.destinationLocationId,
  );

  if (!from || !to || from.id === to.id) {
    throw new Error(
      "Source or destination is missing or invalid.",
    );
  }

  assertWmsLocationCodes(task, from, to);

  if (
    from.loadType !== to.loadType ||
    basketOf(from)?.id !== task.basketId ||
    basketOf(to) ||
    inventoryOf(to).length > 0
  ) {
    throw new Error(
      "Monitor does not match a load remaining at the source. Check the locations before reviewing.",
    );
  }

  const loadLocations = locations.filter(
    (location) => basketOf(location)?.id === task.basketId,
  );

  if (loadLocations.length !== 1) {
    throw new Error(
      "The load appears in multiple locations. Check Monitor.",
    );
  }

  if (
    data.history != null &&
    !Array.isArray(data.history)
  ) {
    throw new Error("Warehouse history is invalid.");
  }

  const reviews = data.reviewedStoppedTransfers;

  if (
    reviews != null &&
    (
      typeof reviews !== "object" ||
      Array.isArray(reviews)
    )
  ) {
    throw new Error("Transfer review records are invalid.");
  }

  const review = {
    taskId: task.id,
    resolution: "LOAD_AT_SOURCE",
    rcsStatus: task.rcsStatus,
    bridgeTaskId: task.bridgeTaskId,
    rcsTaskChainCode: task.rcsTaskChainCode,
    basketId: task.basketId,
    sourceLocationId: task.sourceLocationId,
    destinationLocationId: task.destinationLocationId,
    reviewedBy: reviewer,
    note: reason,
    reviewedAt: new Date().toISOString(),
  };

  data.reviewedStoppedTransfers = {
    ...(reviews || {}),
    [task.id]: review,
  };

  data.history = [
    {
      ...review,
      id: `REVIEW-${crypto.randomUUID()}`,
      type: "TRANSFER_REVIEW",
      createdAt: review.reviewedAt,
      shelfId: from.id,
      locationCode: from.code,
    },
    ...(data.history || []),
  ];

  // Save the review and its history together.
  // Load location, inventory and RCS status stay unchanged.
  localStorage.setItem(
    MONITOR_KEY,
    JSON.stringify(data),
  );

  window.dispatchEvent(
    new CustomEvent("wms-monitor-data-changed"),
  );

  return review;
}

export function isReserved(
  id,
  except = "",
  data = readMonitor(),
  queue = readQueue()
) {
  const locations = shelvesOf(data);
  const completed = data.completedBasketTransfers || {};

  return queue.some((task) => {
    if (task.id === except) {
      return false;
    }

    // Release the reservation after a stopped task
    // has been reviewed.
    if (isStoppedTransferReviewed(task, data)) {
      return false;
    }

    if (task.rcsStatus === "COMPLETED") {
      const key =
        task.rcsTaskChainCode || task.bridgeTaskId;

      if (
        key &&
        Object.prototype.hasOwnProperty.call(
          completed,
          key
        )
      ) {
        return false;
      }

      // Keep the reservation until the completed
      // transfer has updated the warehouse data.
    }

    return [
      task.sourceLocationId,
      task.destinationLocationId,
    ]
      .filter(Boolean)
      .some((pointId) =>
        laneIds(locations, pointId).includes(id)
      );
  });
}

export function assertEditable(id) {
  if (isReserved(id)) {
    throw new Error(
      "This location is reserved by a transfer. Remove an unsent task or review the submitted task before editing.",
    );
  }
}

export function validateTransfer(
  fromId,
  toId,
  except = "",
  expectedBasket = "",
) {
  const shelves = shelvesOf(readMonitor());

  const from = findLocation(shelves, fromId);
  const to = findLocation(shelves, toId);

  if (!from || !to || from.id === to.id) {
    throw new Error("Choose two different locations.");
  }

  if (from.loadType !== to.loadType) {
    throw new Error(
      "Source and destination must support the same load type.",
    );
  }

  if (!from.basket?.id) {
    throw new Error(
      "The source has no load or its internal load ID is missing.",
    );
  }

  if (to.basket || to.inventory.length) {
    throw new Error(
      "Destination must be empty: one load per location.",
    );
  }

  for (const shelf of [from, to]) {
    if (
      typeof shelf.code !== "string" ||
      !shelf.code.trim() ||
      shelves.filter(
        (item) => item.code === shelf.code,
      ).length !== 1
    ) {
      throw new Error(
        "WMS location codes must be present and unique.",
      );
    }

    if (
      ["BLOCKED", "MAINTENANCE"].includes(shelf.status)
    ) {
      throw new Error("Location is unavailable.");
    }

    if (isReserved(shelf.id, except)) {
      throw new Error(
        "Location already reserved by another transfer.",
      );
    }
  }

  if (
    expectedBasket &&
    from.basket.id !== expectedBasket
  ) {
    throw new Error("The source load has changed.");
  }

  if (
    from.inventory.some(
      (item) => Number(item.reserved) > 0,
    )
  ) {
    throw new Error(
      "Resolve outbound stock reservations before moving this load.",
    );
  }

  // Check the possible rear destination.
  // Keep the original selected destination for the RCS command.
  const actual = completedDestination(shelves, to);

  if (isReserved(actual.id, except)) {
    throw new Error(
      "The possible depth-2 destination is reserved by another transfer.",
    );
  }

  return { from, to };
}

function assertWmsLocationCodes(task, from, to) {
  // New tasks keep WMS location codes separate from RCS codes.
  // Legacy tasks used the same code for both.
  const expectedSourceCode =
    Object.prototype.hasOwnProperty.call(
      task,
      "sourceWmsLocationCode",
    )
      ? task.sourceWmsLocationCode
      : task.sourceRcsPointCode;

  const expectedDestinationCode =
    Object.prototype.hasOwnProperty.call(
      task,
      "destinationWmsLocationCode",
    )
      ? task.destinationWmsLocationCode
      : task.destinationRcsPointCode;

  if (
    (
      expectedSourceCode != null &&
      String(from.code || "") !== String(expectedSourceCode)
    ) ||
    (
      expectedDestinationCode != null &&
      String(to.code || "") !== String(expectedDestinationCode)
    )
  ) {
    throw new Error(
      "WMS location codes changed. Check physical locations and Monitor before continuing.",
    );
  }
}

// Resolve the final WMS location only.
// Never change the destination sent to RCS.
function completedDestination(locations, requested) {
  if (Number(requested.depth || 1) !== 1) {
    return requested;
  }

  const rearSlots = locations.filter(
    (shelf) =>
      shelf.rack === requested.rack &&
      Number(shelf.level) === Number(requested.level) &&
      Number(shelf.depth || 1) === 2,
  );

  if (rearSlots.length > 1) {
    throw new Error(
      "Duplicate depth-2 slots. Check Warehouse Monitor.",
    );
  }

  const rear = rearSlots[0];

  if (
    !rear ||
    basketOf(rear) ||
    inventoryOf(rear).length
  ) {
    return requested;
  }

  // An empty but blocked D2 requires review.
  if (
    ["BLOCKED", "MAINTENANCE"].includes(rear.status)
  ) {
    throw new Error(
      "RCS completed, but depth 2 is unavailable. Check the physical load position before updating Monitor.",
    );
  }

  return rear;
}

export function completeBasketTransfer(task) {
  if (
    !task?.basketId ||
    task.rcsStatus !== "COMPLETED"
  ) {
    return false;
  }

  const data = readMonitor();

  const key =
    task.rcsTaskChainCode || task.bridgeTaskId;

  if (!key) {
    throw new Error("Missing confirmed transfer ID.");
  }

  // Apply each completed transfer only once.
  if (
    Object.prototype.hasOwnProperty.call(
      data.completedBasketTransfers || {},
      key,
    )
  ) {
    return true;
  }

  const locations = shelvesOf(data);

  const sourceInfo = findLocation(
    locations,
    task.sourceLocationId,
  );

  const destinationInfo = findLocation(
    locations,
    task.destinationLocationId,
  );

  if (
    !sourceInfo ||
    !destinationInfo ||
    sourceInfo.id === destinationInfo.id
  ) {
    throw new Error(
      "RCS completed, but WMS locations are missing or invalid. Check Monitor before continuing.",
    );
  }

  if (
    sourceInfo.loadType !== destinationInfo.loadType
  ) {
    throw new Error(
      "RCS completed, but the WMS load types no longer match. Check Monitor before continuing.",
    );
  }

  assertWmsLocationCodes(
    task,
    sourceInfo,
    destinationInfo,
  );

  if (
    basketOf(destinationInfo) ||
    inventoryOf(destinationInfo).length
  ) {
    throw new Error(
      "RCS completed, but the requested destination is occupied. Check physical locations and Monitor.",
    );
  }

  const actualDestination = completedDestination(
    locations,
    destinationInfo,
  );

  if (isReserved(actualDestination.id, task.id)) {
    throw new Error(
      "RCS completed, but the landing lane has another reservation. Review the conflicting tasks.",
    );
  }

  // Use the original shelf objects so the update is saved together.
  const shelves = data.racks.flatMap(
    (rack) => rack.shelves,
  );

  const from = findLocation(
    shelves,
    task.sourceLocationId,
  );

  const to = findLocation(
    shelves,
    actualDestination.id,
  );

  const load = basketOf(from);
  const sourceInventory = inventoryOf(from);

  if (
    load?.id !== task.basketId ||
    basketOf(to) ||
    inventoryOf(to).length
  ) {
    throw new Error(
      "RCS completed, but load locations conflict. Check physical locations and Monitor before continuing.",
    );
  }

  if (
    sourceInventory.some(
      (item) => Number(item.reserved) > 0,
    )
  ) {
    throw new Error(
      "RCS completed, but the source has stock reservations. Review warehouse operations before updating its location.",
    );
  }

  if (
    data.history != null &&
    !Array.isArray(data.history)
  ) {
    throw new Error(
      "Warehouse history is invalid. Restore it before updating the completed transfer.",
    );
  }

  const completedAt = new Date().toISOString();

  to.basket = load;
  to.inventory = sourceInventory;

  from.basket = null;
  from.inventory = [];

  data.completedBasketTransfers = {
    ...data.completedBasketTransfers,
    [key]: completedAt,
  };

  data.history = [
    {
      id: `TRANSFER-${key}`,
      type: "BASKET_TRANSFER",
      basketId: task.basketId,
      loadType: sourceInfo.loadType,

      sourceLocationCode: from.code,
      locationCode: to.code,
      shelfId: to.id,

      sourceLocationId: from.id,
      destinationLocationId: to.id,

      requestedDestinationLocationId:
        destinationInfo.id,

      requestedDestinationLocationCode:
        destinationInfo.code,

      actualDestinationDepth:
        Number(actualDestination.depth || 1),

      autoPushedToDepth2:
        actualDestination.id !== destinationInfo.id,

      sourceRcsTargetType:
        task.sourceRcsTargetType || "STORAGE",

      destinationRcsTargetType:
        task.destinationRcsTargetType || "STORAGE",

      sourceRcsPointCode:
        task.sourceRcsPointCode || "",

      destinationRcsPointCode:
        task.destinationRcsPointCode || "",

      rcsTaskType: task.rcsTaskType || "",
      rcsRobotCode: task.rcsRobotCode || "",

      createdAt: completedAt,
      rcsTaskChainCode: key,
      bridgeTaskId: task.bridgeTaskId || "",
    },
    ...(data.history || []),
  ];

  // Save location, inventory, history and completion marker together.
  localStorage.setItem(
    MONITOR_KEY,
    JSON.stringify(data),
  );

  window.dispatchEvent(
    new CustomEvent("wms-monitor-data-changed"),
  );

  return true;
}

export function binLocationPatch(
  locationId,
  remove = false,
) {
  const data = readMonitor();

  const shelf = findLocation(
    shelvesOf(data),
    locationId,
  );

  if (!shelf) {
    throw new Error("Location not found.");
  }

  assertEditable(locationId);

  if (
    ["BLOCKED", "MAINTENANCE"].includes(shelf.status)
  ) {
    throw new Error("This location is unavailable.");
  }

  const outboundOperations =
    data.outboundOperations || [];

  if (!Array.isArray(outboundOperations)) {
    throw new Error(
      "Invalid outbound operation data.",
    );
  }

  if (
    outboundOperations.some(
      (operation) =>
        operation.shelfId === locationId &&
        ![
          "COMPLETED",
          "CANCELLED",
          "CANCELED",
        ].includes(operation.status),
    )
  ) {
    throw new Error(
      "Finish or cancel outbound tasks first.",
    );
  }

  if (remove) {
    if (!shelf.basket) {
      throw new Error(
        "This location is already empty.",
      );
    }

    if (
      shelf.inventory.some(
        (item) =>
          Number(item.quantity) > 0 ||
          Number(item.reserved) > 0,
      )
    ) {
      throw new Error(
        "Remove products and reservations before Unbin.",
      );
    }

    return {
      basket: null,
      inventory: [],
      capacity: 1,
    };
  }

  if (shelf.basket) {
    throw new Error(
      "This location is already occupied.",
    );
  }

  // Internal WMS ID only, not an RCS carrier number.
  return {
    basket: {
      id: `${shelf.loadType}-${crypto.randomUUID()}`,
    },
    capacity: 1,
  };
}