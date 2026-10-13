import { icon } from './icons.ts';

export interface ArchiveDropdown {
  element: HTMLElement;
  select: HTMLSelectElement;
  dispose(): void;
}

interface DropdownOptions {
  options: Array<{ value: string; label: string }>;
  value: string;
  ariaLabel: string;
  className: string;
  selectClassName: string;
  onChange?: (value: string) => void;
}

let nextDropdownId = 0;

export function createArchiveDropdown(config: DropdownOptions): ArchiveDropdown {
  const id = `archive-dropdown-${++nextDropdownId}`;
  const element = document.createElement('span');
  element.className = `archive-dropdown ${config.className}`;
  const select = document.createElement('select');
  select.className = config.selectClassName;
  select.hidden = true;
  for (const item of config.options) {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    select.append(option);
  }
  select.value = config.value;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'archive-dropdown-trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-label', config.ariaLabel);
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', id);
  const value = document.createElement('span');
  value.className = 'archive-dropdown-value';
  trigger.append(value, icon('chevron-down'));
  const list = document.createElement('div');
  list.id = id;
  list.className = 'archive-dropdown-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', config.ariaLabel);
  list.hidden = true;
  const optionElements = config.options.map((item, index) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'archive-dropdown-option';
    option.id = `${id}-option-${index}`;
    option.setAttribute('role', 'option');
    option.setAttribute('tabindex', '-1');
    option.textContent = item.label;
    option.addEventListener('click', () => choose(index));
    list.append(option);
    return option;
  });
  let active = 0;
  const selectedIndex = () => Math.max(0, config.options.findIndex(item => item.value === select.value));
  const setActive = (index: number) => {
    active = Math.max(0, Math.min(index, optionElements.length - 1));
    optionElements.forEach((option, position) => option.classList.toggle('is-active', position === active));
    trigger.setAttribute('aria-activedescendant', optionElements[active].id);
    optionElements[active].scrollIntoView?.({ block: 'nearest' });
  };
  const onOutside = (event: PointerEvent) => {
    if (!element.contains(event.target as Node)) close();
  };
  const close = () => {
    if (list.hidden) return;
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
    document.removeEventListener('pointerdown', onOutside);
  };
  const open = () => {
    if (!list.hidden) return;
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    setActive(selectedIndex());
    document.addEventListener('pointerdown', onOutside);
  };
  const choose = (index: number) => {
    close();
    const nextValue = config.options[index].value;
    if (select.value !== nextValue) {
      select.value = nextValue;
      select.dispatchEvent(new select.ownerDocument.defaultView!.Event('change', { bubbles: true }));
    }
    if (trigger.isConnected) trigger.focus();
  };
  const sync = () => {
    const current = selectedIndex();
    value.textContent = config.options[current].label;
    optionElements.forEach((option, index) => option.setAttribute('aria-selected', String(index === current)));
  };
  select.addEventListener('change', () => { sync(); config.onChange?.(select.value); });
  sync();
  trigger.addEventListener('click', () => { if (list.hidden) open(); else close(); });
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); event.stopPropagation();
      if (list.hidden) open();
      setActive(active + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); event.stopPropagation();
      open(); setActive(event.key === 'Home' ? 0 : optionElements.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation();
      if (list.hidden) open(); else choose(active);
    } else if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault(); event.stopPropagation(); close();
    } else if (event.key === 'Tab') close();
  });
  element.append(select, trigger, list);
  return { element, select, dispose: close };
}
