import { useState } from 'react';
import {
  EMPTY_FILTERS, FIELDS, NEEDS_VALUE, activeCount, choicesFor, fieldOf, isFiltering, newRule, opsFor,
} from '../lib/filters';
import { Popover } from './EmojiPicker';
import { Icon } from './ui';

// Search, plus a Filters panel above a project's views: quick filters to toggle, and filters
// added field by field (built-in fields and the project's custom fields), all of which must match.
// The logic is in lib/filters.js.

const QUICK = [
  ['incomplete', 'Incomplete tasks', 'check'],
  ['completed', 'Completed tasks', 'check'],
  ['mine', 'Just my tasks', 'user'],
  ['due_this_week', 'Due this week', 'calendar'],
  ['due_next_week', 'Due next week', 'calendar'],
];
const COMPLETED_WHEN = [['completed', 'Any time'], ['completed:today', 'Today'], ['completed:7', 'In the last 7 days'], ['completed:30', 'In the last 30 days']];

export default function FilterBar({ filters, onChange, members, labels, fields = [], resultCount, onManageFields }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [whenOpen, setWhenOpen] = useState(false);
  const count = activeCount(filters);
  const set = (patch) => onChange({ ...filters, ...patch });

  const completed = filters.quick.find((q) => q.startsWith('completed'));
  const isOn = (key) => (key === 'completed' ? !!completed : filters.quick.includes(key));
  // Clicking a chip turns it on or off; `variant` (from Completed's menu) switches it to that one.
  const toggleQuick = (key, variant) => {
    let quick = filters.quick.filter((q) => (key === 'completed' ? !q.startsWith('completed') : q !== key));
    if (isOn(key) && !variant) return set({ quick });
    // Incomplete and completed can't both be on.
    if (key === 'completed') quick = quick.filter((q) => q !== 'incomplete');
    if (key === 'incomplete') quick = quick.filter((q) => !q.startsWith('completed'));
    return set({ quick: [...quick, variant ?? key] });
  };

  const addRule = (field) => {
    setAdding(false);
    set({ rules: [...filters.rules, newRule(field)] });
  };
  const updateRule = (id, patch) => set({ rules: filters.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const removeRule = (id) => set({ rules: filters.rules.filter((r) => r.id !== id) });
  const custom = fields.map((f) => fieldOf(`cf:${f.id}`, fields));

  return (
    <div className="filter-bar">
      <label className="search-box">
        <Icon.search />
        <input type="search" placeholder="Search tasks" value={filters.query} onChange={(e) => set({ query: e.target.value })}
          aria-label="Search tasks" />
      </label>
      <div className="menu-wrap">
        <button type="button" className={`btn btn-ghost btn-small${count ? ' is-active' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Icon.filter /> Filter{count ? ` · ${count}` : ''}
        </button>
        {open && (
          <Popover onClose={() => setOpen(false)} className="filter-panel" label="Filters">
            <div className="filter-head">
              <h4>Filters</h4>
              <button type="button" className="link-btn" disabled={!count}
                onClick={() => set({ quick: [], rules: [] })}>Clear</button>
            </div>

            <p className="filter-section">Quick filters</p>
            <div className="quick-filters">
              {QUICK.map(([key, label, icon]) => {
                const Glyph = Icon[icon];
                const on = isOn(key);
                const text = key === 'completed' && completed && completed !== 'completed'
                  ? `Completed ${COMPLETED_WHEN.find(([v]) => v === completed)?.[1].toLowerCase()}` : label;
                return (
                  <span key={key} className={`quick-chip${on ? ' is-on' : ''}`}>
                    <button type="button" onClick={() => toggleQuick(key)} aria-pressed={on}>
                      <Glyph width="15" height="15" /> {text}
                    </button>
                    {key === 'completed' && (
                      <span className="menu-wrap">
                        <button type="button" className="quick-caret" onClick={() => setWhenOpen((o) => !o)} aria-label="When completed" aria-expanded={whenOpen}>
                          <Icon.chevron width="13" height="13" />
                        </button>
                        {whenOpen && (
                          <Popover onClose={() => setWhenOpen(false)} className="quick-when" label="When completed">
                            {COMPLETED_WHEN.map(([value, name]) => (
                              <button key={value} type="button" className={completed === value ? 'is-on' : ''}
                                onClick={() => { setWhenOpen(false); toggleQuick('completed', value); }}>
                                {name}{completed === value && <Icon.check width="14" height="14" />}
                              </button>
                            ))}
                          </Popover>
                        )}
                      </span>
                    )}
                  </span>
                );
              })}
            </div>

            {filters.rules.length > 0 && (
              <ul className="filter-rules">
                {filters.rules.map((r) => (
                  <RuleRow key={r.id} rule={r} field={fieldOf(r.field, fields)} members={members} labels={labels}
                    onChange={(patch) => updateRule(r.id, patch)} onRemove={() => removeRule(r.id)} />
                ))}
              </ul>
            )}

            <div className="menu-wrap filter-add">
              <button type="button" className="link-btn" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
                <Icon.plus width="15" height="15" /> Add filter
              </button>
              {adding && (
                <Popover onClose={() => setAdding(false)} className="filter-fields" label="Add a filter">
                  {FIELDS.map((field) => <FieldItem key={field.key} field={field} onPick={addRule} />)}
                  {custom.length > 0 && <hr />}
                  {custom.map((field) => <FieldItem key={field.key} field={field} onPick={addRule} />)}
                  {onManageFields && (
                    <>
                      <hr />
                      <button type="button" className="filter-manage" onClick={() => { setAdding(false); setOpen(false); onManageFields(); }}>
                        <Icon.settings width="16" height="16" /> {custom.length ? 'Manage custom fields' : 'Add a custom field'}
                      </button>
                    </>
                  )}
                </Popover>
              )}
            </div>
          </Popover>
        )}
      </div>
      {isFiltering(filters) && (
        <span className="muted small">
          {resultCount} match{resultCount === 1 ? '' : 'es'} · <button type="button" className="link-btn" onClick={() => onChange(EMPTY_FILTERS)}>Clear</button>
        </span>
      )}
    </div>
  );
}

const KIND_ICON = { select: 'list', multi_select: 'tag', person: 'user', text: 'edit', number: 'info', date: 'calendar' };

function FieldItem({ field, onPick }) {
  const Glyph = Icon[field.custom ? KIND_ICON[field.kind] : field.icon] ?? Icon.tag;
  return (
    <button type="button" onClick={() => onPick(field)}>
      <Glyph width="17" height="17" /> {field.name}
    </button>
  );
}

// One filter: the field, its condition, and the value when the condition needs one.
function RuleRow({ rule, field, members, labels, onChange, onRemove }) {
  if (!field) {
    return (
      <li className="filter-rule">
        <span className="filter-field muted">A deleted field</span>
        <button type="button" className="icon-btn" onClick={onRemove} aria-label="Remove this filter"><Icon.x /></button>
      </li>
    );
  }
  const ops = opsFor(field);
  const choices = choicesFor(field, { members, labels });
  const needs = NEEDS_VALUE.has(rule.op) && field.kind !== 'completion';

  let input = null;
  if (field.kind === 'completion') {
    input = (
      <select className="input" value={rule.value} onChange={(e) => onChange({ value: e.target.value })} aria-label="Status">
        <option value="incomplete">Incomplete</option>
        <option value="complete">Complete</option>
      </select>
    );
  } else if (needs && field.kind === 'date') {
    input = <input className="input" type="date" value={rule.value} onChange={(e) => onChange({ value: e.target.value })} aria-label="Date" />;
  } else if (needs && field.kind === 'text') {
    input = <input className="input" value={rule.value} placeholder="Text" onChange={(e) => onChange({ value: e.target.value })} aria-label="Text" />;
  } else if (needs && field.kind === 'number') {
    input = <input className="input" type="number" value={rule.value} onChange={(e) => onChange({ value: e.target.value })} aria-label="Number" />;
  } else if (needs) {
    input = (
      <select className="input" value={rule.value} onChange={(e) => onChange({ value: e.target.value })} aria-label={field.name}>
        <option value="">Choose…</option>
        {choices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    );
  }

  return (
    <li className="filter-rule">
      <span className="filter-field">{field.name}</span>
      {ops.length > 1 && (
        <select className="input" value={rule.op} onChange={(e) => onChange({ op: e.target.value })} aria-label={`${field.name} condition`}>
          {ops.map(([op, label]) => <option key={op} value={op}>{label}</option>)}
        </select>
      )}
      {input}
      <button type="button" className="icon-btn" onClick={onRemove} aria-label={`Remove the ${field.name} filter`} title="Remove"><Icon.x /></button>
    </li>
  );
}
