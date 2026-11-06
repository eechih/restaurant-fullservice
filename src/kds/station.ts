import type { StationFilter } from '../domain';

const STORAGE_KEY = 'kds-station';

/** Each kitchen screen remembers which station it shows. */
export function loadStation(): StationFilter {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'ALL';
  } catch {
    return 'ALL';
  }
}

export function saveStation(station: StationFilter) {
  try {
    localStorage.setItem(STORAGE_KEY, station);
  } catch {
    // The choice then lasts until the page is reloaded.
  }
}
