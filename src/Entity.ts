import { resizeComponents } from "./Component.js";
import {
  $notQueries,
  $queries,
  queryAddEntity,
  queryCheckEntity,
  queryRemoveEntity,
} from "./Query.js";
import { $localEntities, $localEntityLookup, resizeWorlds } from "./World.js";
import { setSerializationResized } from "./Serialize.js";
import { World } from "./Types.js";

export const $entityMasks = Symbol("entityMasks");
export const $entityComponents = Symbol("entityComponents");
export const $entitySparseSet = Symbol("entitySparseSet");
export const $entityArray = Symbol("entityArray");
export const $entityIndices = Symbol("entityIndices");
export const $removedEntities = Symbol("removedEntities");

let defaultSize = 100000;

// need a global EID cursor which all worlds and all components know about
// so that world entities can posess entire rows spanning all component tables
let globalEntityCursor = 0;
let globalSize = defaultSize;
let resizeThreshold = () => globalSize - globalSize / 5;

export const getGlobalSize = () => globalSize;

// removed eids should also be global to prevent memory leaks
const removed: number[] = [];
const defaultRemovedReuseThreshold = 0.01;
let removedReuseThreshold = defaultRemovedReuseThreshold;

export const resetGlobals = () => {
  globalSize = defaultSize;
  globalEntityCursor = 0;
  removedReuseThreshold = defaultRemovedReuseThreshold;
  removed.length = 0;
};

export const getDefaultSize = () => defaultSize;

/**
 * Sets the default maximum number of entities for worlds and component stores.
 */
export const setDefaultSize = (newSize: number) => {
  const oldSize = globalSize;

  defaultSize = newSize;
  resetGlobals();

  globalSize = newSize;
  resizeWorlds(newSize);
  resizeComponents(newSize);
  setSerializationResized(true);

  console.info(
    `👾 bitECS - resizing all data stores from ${oldSize} to ${newSize}`
  );
};

/**
 * Sets the number of entities that must be removed before removed entity ids begin to be recycled.
 * This should be set to as a % (0-1) of `defaultSize` that you would never likely remove/add on a single frame.
 */
export const setRemovedRecycleThreshold = (newThreshold: number) => {
  removedReuseThreshold = newThreshold;
};

export const getEntityCursor = () => globalEntityCursor;
export const getRemovedEntities = () => removed;

export const eidToWorld = new Map();

/**
 * Adds a new entity to the specified world.
 */
export const addEntity = (world: World): number => {
  // if data stores are 80% full
  if (globalEntityCursor >= resizeThreshold()) {
    // grow by half the original size rounded up to a multiple of 4
    const size = globalSize;
    const amount = Math.ceil(size / 2 / 4) * 4;
    setDefaultSize(size + amount);
  }

  const eid =
    removed.length > Math.round(defaultSize * removedReuseThreshold)
      ? removed.shift()!
      : globalEntityCursor++;

  world[$entitySparseSet].add(eid);
  eidToWorld.set(eid, world);

  world[$notQueries].forEach((q) => {
    const match = queryCheckEntity(world, q, eid);
    if (match) queryAddEntity(q, eid);
  });

  world[$entityComponents].set(eid, new Set());

  return eid;
};

/**
 * Removes an existing entity from the specified world.
 */
export const removeEntity = (world: World, eid: number) => {
  // Check if entity is already removed
  if (!world[$entitySparseSet].has(eid)) return;

  // Remove entity from all queries
  // TODO: archetype graph
  world[$queries].forEach((q) => {
    queryRemoveEntity(world, q, eid);
  });

  // Free the entity
  removed.push(eid);

  // remove all eid state from world
  world[$entitySparseSet].remove(eid);
  world[$entityComponents].delete(eid);

  // remove from deserializer mapping
  world[$localEntities].delete(world[$localEntityLookup].get(eid));
  world[$localEntityLookup].delete(eid);

  // Clear entity bitmasks
  for (let i = 0; i < world[$entityMasks].length; i++)
    world[$entityMasks][i][eid] = 0;
};

/**
 *  Returns an array of components that an entity possesses.
 */
export const getEntityComponents = (world: World, eid: number) => {
  if (eid === undefined) throw new Error("bitECS - entity is undefined.");
  if (!world[$entitySparseSet].has(eid))
    throw new Error("bitECS - entity does not exist in the world.");
  return Array.from(world[$entityComponents].get(eid)!);
};

/**
 * Checks the existence of an entity in a world
 */
export const entityExists = (world: World, eid: number) => {
  world[$entitySparseSet].has(eid);
}