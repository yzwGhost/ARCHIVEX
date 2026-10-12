import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Check, ChevronDown,
  Download, Expand, Plus, RotateCcw, ScanEye, Search, Shrink, Upload, X,
  createElement,
} from 'lucide';

const icons = {
  'arrow-down': ArrowDown,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'arrow-up': ArrowUp,
  'arrow-up-right': ArrowUpRight,
  check: Check,
  'chevron-down': ChevronDown,
  download: Download,
  expand: Expand,
  plus: Plus,
  replay: RotateCcw,
  inspect: ScanEye,
  search: Search,
  shrink: Shrink,
  upload: Upload,
  close: X,
} as const;

export type IconName = keyof typeof icons;

export function icon(name: IconName): SVGElement {
  return createElement(icons[name], { class: 'ui-icon', 'aria-hidden': 'true', focusable: 'false' });
}

export function hydrateIcons(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach(placeholder => {
    const name = placeholder.dataset.icon as IconName;
    if (Object.hasOwn(icons, name)) placeholder.replaceWith(icon(name));
  });
}

export function setIconLabel(element: HTMLElement, name: IconName, label: string): void {
  element.replaceChildren(icon(name), document.createTextNode(label));
}
