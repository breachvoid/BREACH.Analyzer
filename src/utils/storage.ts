/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef, Dispatch, SetStateAction } from 'react';

// Current Storage Format version for future transformations / versioned migrations
const STORAGE_VERSION_KEY = 'breach_storage_version';
const CURRENT_STORAGE_VERSION = 1;

/**
 * Perform versioned migrations if necessary.
 * This runs on module import to ensure the client-side database conforms to our v1 schema.
 */
function runMigrations(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;

    const savedVersionStr = localStorage.getItem(STORAGE_VERSION_KEY);
    const savedVersion = savedVersionStr ? parseInt(savedVersionStr, 10) : 0;

    if (savedVersion < CURRENT_STORAGE_VERSION) {
      console.info(`Migrating localStorage schema from version ${savedVersion} to ${CURRENT_STORAGE_VERSION}...`);

      // Migration: Convert raw string "true"/"false" toggles to pure booleans for standard keys
      const booleanKeys = [
        'breach_deck1_show_grid',
        'breach_deck2_show_grid',
        'breach_loop_track',
        'breach_autoplay_next',
        'breach_loudness_auto_reset',
        'breach_settings_panel_open'
      ];

      for (const key of booleanKeys) {
        const val = localStorage.getItem(key);
        if (val === 'true') {
          localStorage.setItem(key, JSON.stringify(true));
        } else if (val === 'false') {
          localStorage.setItem(key, JSON.stringify(false));
        }
      }

      // Convert number string keys to raw stringified numbers (safeguard)
      const numberKeys = [
        'breach_primary_height',
        'breach_secondary_height',
        'breach_zoom_min',
        'breach_zoom_max'
      ];

      for (const key of numberKeys) {
        const val = localStorage.getItem(key);
        if (val && !val.startsWith('{') && !val.startsWith('[') && !isNaN(Number(val))) {
          localStorage.setItem(key, JSON.stringify(Number(val)));
        }
      }

      // Update version tag
      localStorage.setItem(STORAGE_VERSION_KEY, String(CURRENT_STORAGE_VERSION));
      console.info('Migrations fully completed.');
    }
  } catch (err) {
    console.error('Migration execution failed due to storage blockages or exceptions:', err);
  }
}

// Trigger initial migration pass on initialization
if (typeof window !== 'undefined') {
  runMigrations();
}



// Map from key to current pending write details to prevent excessive synchronous storage writes
const pendingStorageWrites = new Map<string, { value: any; initiatorId: string }>();

// Flush a specific key to localStorage synchronously
function flushPendingWrite(key: string): void {
  const pending = pendingStorageWrites.get(key);
  if (!pending) return;

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (pending.value === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(pending.value));
      }
      // Broadcast same-tab/iframe update
      window.dispatchEvent(
        new CustomEvent('breach_storage_update', {
          detail: { key, value: pending.value, initiatorId: pending.initiatorId }
        })
      );
    }
  } catch (err) {
    console.error(`SafeStorage: Debounced flush failed for key "${key}"`, err);
  } finally {
    pendingStorageWrites.delete(key);
  }
}

// Flush all pending storage updates synchronously (e.g. before page unload)
function flushAllPendingWrites(): void {
  for (const key of Array.from(pendingStorageWrites.keys())) {
    flushPendingWrite(key);
  }
}

// Attach page-unload listeners to flush all pending updates before tab closes
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushAllPendingWrites);
  window.addEventListener('pagehide', flushAllPendingWrites);
}

/**
 * Storage Service containing pure helper functions with safety guarantees
 */
export const SafeStorage = {
  /**
    * Reads, parses, validates, and returns data from localStorage.
    * Leverages robust recovery and clean defaults if parsing/validation errors occur.
    */
  get<T>(key: string, defaultValue: T, validator?: (val: any) => boolean): T {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return defaultValue;
      }

      // If there is an in-memory pending write, prefer it as it holds the single source of truth
      if (pendingStorageWrites.has(key)) {
        const pending = pendingStorageWrites.get(key);
        if (pending && (validator === undefined || validator(pending.value))) {
          return pending.value as T;
        }
      }

      const raw = localStorage.getItem(key);
      if (raw === null) {
        return defaultValue;
      }

      // Try safe parsing first
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch (jsonErr) {
        // If it's a raw string not wrapped in JSON quotes (legacy compatibility), return it if type matches
        if (typeof defaultValue === 'string') {
          return raw as unknown as T;
        }
        throw jsonErr;
      }

      // Support legacy string values stored directly on boolean/numbers
      if (typeof defaultValue === 'boolean' && typeof parsed === 'string') {
        parsed = parsed === 'true';
      } else if (typeof defaultValue === 'number' && typeof parsed === 'string') {
        const num = Number(parsed);
        parsed = isNaN(num) ? defaultValue : num;
      }

      // Schema/Type validation
      if (validator && !validator(parsed)) {
        console.warn(`Validation failed for key "${key}". Value was recovered to default.`);
        return defaultValue;
      }

      return parsed as T;
    } catch (err) {
      console.error(`Active SafeStorage Recovery: Failed to retrieve or parse key "${key}". Resetting to default.`, err);
      // Attempt to clear corrupt key to recover cleanly
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.removeItem(key);
        }
      } catch {}
      return defaultValue;
    }
  },

  /**
   * Safely serializes and persists a value to localStorage
   */
  set<T>(key: string, value: T, initiatorId?: string): void {
    pendingStorageWrites.delete(key);
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;

      const serialized = JSON.stringify(value);
      localStorage.setItem(key, serialized);

      // Same-window/Tab notification
      window.dispatchEvent(
        new CustomEvent('breach_storage_update', {
          detail: { key, value, initiatorId }
        })
      );
    } catch (err) {
      console.error(`SafeStorage: Failed to serialise & persist key "${key}"`, err);
    }
  },

  /**
   * Safely removes a key from localStorage
   */
  remove(key: string, initiatorId?: string): void {
    pendingStorageWrites.delete(key);
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      localStorage.removeItem(key);

      // Same-window/Tab notification
      window.dispatchEvent(
        new CustomEvent('breach_storage_update', {
          detail: { key, value: null, initiatorId }
        })
      );
    } catch (err) {
      console.error(`SafeStorage: Failed to remove key "${key}"`, err);
    }
  }
};

/**
 * Reusable React Hook: usePersistentState
 * Features:
 *  - Full safe parsing, validation fallbacks, and recovery built-in.
 *  - High-performance 120ms debounced disk-writes to prevent main-thread lag during slider dragging.
 *  - Window lifecycle and element unmount listeners to flush writes instantly before closing/unmounting.
 *  - Real-time cross-tab/iframe synchronization via window 'storage' event listener.
 *  - Real-time same-window cross-component synchronization via custom 'breach_storage_update' event listener. This eliminates duplicated, lagging, out-of-sync state!
 */
export function usePersistentState<T>(
  key: string,
  defaultValue: T,
  validator?: (val: any) => boolean
): [T, Dispatch<SetStateAction<T>>] {
  // Unique ID to identify this specific hook instance and prevent redundant self-updates
  const instanceId = useRef(Math.random().toString(36).slice(2));

  // Initialize state using read helper
  const [state, setState] = useState<T>(() => SafeStorage.get<T>(key, defaultValue, validator));

  // Keep track of the current value to write and the debounce timer
  const pendingValueRef = useRef<any>(null);
  const timeoutRef = useRef<number | null>(null);

  // Override setter to automate persistence and broadcast changes locally
  const setPersistentState = useCallback(
    (value: SetStateAction<T>) => {
      setState((prevValue) => {
        const newValue = value instanceof Function ? value(prevValue) : value;

        // Save immediately to the module-level pending map
        pendingStorageWrites.set(key, { value: newValue, initiatorId: instanceId.current });
        pendingValueRef.current = newValue;

        // Clear existing debounce timer
        if (timeoutRef.current !== null) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }

        // Schedule writing with a short 120ms debounce delay (highly responsive, saves ~99% I/O)
        timeoutRef.current = window.setTimeout(() => {
          if (pendingStorageWrites.has(key) && pendingStorageWrites.get(key)?.value === pendingValueRef.current) {
            flushPendingWrite(key);
          }
          timeoutRef.current = null;
        }, 120);

        return newValue;
      });
    },
    [key]
  );

  // Sync mechanisms: listen to storage and custom events
  useEffect(() => {
    // 1. Same-window multi-component synchronizer
    const handleLocalUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<{ key: string; value: any; initiatorId?: string }>;
      if (customEvent.detail && customEvent.detail.key === key) {
        // Prevent self-triggering updates and unnecessary renders
        if (customEvent.detail.initiatorId === instanceId.current) {
          return;
        }
        const newVal = customEvent.detail.value;
        if (newVal === null) {
          setState(defaultValue);
        } else if (!validator || validator(newVal)) {
          setState(newVal);
        }
      }
    };

    // 2. Cross-tab / Iframe synchronizer
    const handleCrossTabUpdate = (e: StorageEvent) => {
      if (e.key === key) {
        if (e.newValue === null) {
          setState(defaultValue);
        } else {
          try {
            const parsed = JSON.parse(e.newValue);
            if (!validator || validator(parsed)) {
              setState(parsed);
            }
          } catch {
            // Handle legacy strings if that was original value
            if (typeof defaultValue === 'string' && e.newValue !== null) {
              setState(e.newValue as unknown as T);
            }
          }
        }
      }
    };

    window.addEventListener('breach_storage_update', handleLocalUpdate);
    window.addEventListener('storage', handleCrossTabUpdate);

    return () => {
      window.removeEventListener('breach_storage_update', handleLocalUpdate);
      window.removeEventListener('storage', handleCrossTabUpdate);

      // Clean up running timer and flush any pending write immediately on unmount
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
      if (pendingStorageWrites.has(key)) {
        flushPendingWrite(key);
      }
    };
  }, [key, defaultValue, validator]);

  return [state, setPersistentState];
}
