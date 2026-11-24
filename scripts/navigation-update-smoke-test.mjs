import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nav = fs.readFileSync(path.join(root, 'frontend/src/config/navigation.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend/src/App.jsx'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'frontend/src/components/AppShell.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'frontend/src/styles/app.css'), 'utf8');

assert.match(nav, /to:\s*['"]\/system\/update['"]/u, 'Update Center navigation entry is missing');
assert.match(nav, /labelKey:\s*['"]nav\.updates['"]/u, 'Update Center label is missing');
assert.match(app, /Route path=['"]\/system\/update['"]/u, 'Update Center route is missing');
assert.match(app, /<AdminOnly><UpdatePage\s*\/><\/AdminOnly>/u, 'Update Center must stay admin-only');
assert.match(shell, /tmp-primary-navigation/u, 'Primary navigation container is missing');
assert.match(css, /\.tmp-primary-navigation\s*\{[^}]*flex:\s*1 1 auto;[^}]*overflow-y:\s*auto;/su, 'Desktop sidebar navigation must scroll vertically');
assert.doesNotMatch(css, /\.tmp-primary-navigation\s*\{\s*min-width:0;\s*overflow:hidden\s*\}/u, 'Regression: primary navigation may not clip lower admin entries');
assert.match(css, /@media\s*\(min-width:\s*851px\)\s*\{\s*\.tmp-sidebar \.tmp-primary-navigation\s*\{\s*display:block;/su, 'Desktop navigation must not grid-stretch short operator menus');
assert.match(css, /\.tmp-sidebar \.sidebar-nav,\s*\.tmp-sidebar \.tmp-nav-section,\s*\.tmp-sidebar \.tmp-nav-list\s*\{\s*align-content:start;\s*grid-auto-rows:max-content;/su, 'Navigation sections and menu links must remain top-aligned');
assert.match(css, /\.tmp-sidebar-footer\.sidebar-footer\s*\{[^}]*margin-top:auto;/su, 'User and logout controls must stay at the bottom');
assert.doesNotMatch(shell, /sidebar-collapsed sidebar-narrow/u, 'Regression: TMP collapse must not activate CoreUI sidebar-narrow sizing');
assert.match(shell, /sidebarCollapsed \? 'sidebar-collapsed' : ''/u, 'TMP collapse state class is missing');
assert.match(css, /\.app-shell\.tmp-coreui-shell\.sidebar-collapsed\s*\{[^}]*grid-template-columns:72px minmax\(0,1fr\);/su, 'Collapsed shell grid must reserve exactly 72px for the sidebar');
assert.match(css, /\.sidebar-collapsed \.tmp-sidebar\.sidebar\s*\{[^}]*width:72px;[^}]*max-width:72px;/su, 'Collapsed TMP sidebar width must match the shell grid');

console.log('Navigation/update smoke test OK: desktop operator links top-aligned, admin links scroll, footer stays bottom.');
