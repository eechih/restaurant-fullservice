import { useRef, useState } from 'react';
import { App } from './App';
import { createDemoRepository, demoActor } from './data/demoRepository';
import { isRole, ROLE_LABEL, ROLES, type Role } from './domain';

const STORAGE_KEY = 'demo-roles';
const EVERY_ROLE = 'ALL';

/** Each tab keeps its own, so one tab can be the kitchen and another a server. */
function loadRoles(): Role[] {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved && saved !== EVERY_ROLE && isRole(saved)) return [saved];
  } catch {
    // Every role, until the page is reloaded.
  }
  return [...ROLES];
}

/** Demo mode has no accounts, so whoever uses it picks the role to try. */
export function DemoRoot() {
  const [roles, setRoles] = useState(loadRoles);
  const current = useRef(roles);
  current.current = roles;
  const [repository] = useState(() => createDemoRepository(localStorage, () => demoActor(current.current)));

  const choose = (value: string) => {
    const next = isRole(value) ? [value] : [...ROLES];
    setRoles(next);
    try {
      sessionStorage.setItem(STORAGE_KEY, value);
    } catch {
      // See loadRoles.
    }
  };

  const switcher = (
    <label className="role-switcher">
      <span className="visually-hidden">展示角色</span>
      <select
        className="text-input"
        aria-label="展示角色"
        value={roles.length === 1 ? roles[0] : EVERY_ROLE}
        onChange={(event) => choose(event.target.value)}
      >
        <option value={EVERY_ROLE}>角色：全部</option>
        {ROLES.map((role) => (
          <option key={role} value={role}>
            角色：{ROLE_LABEL[role]}
          </option>
        ))}
      </select>
    </label>
  );

  return <App repository={repository} roles={roles} roleSwitcher={switcher} />;
}
