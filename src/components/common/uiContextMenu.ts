import type { Component } from "vue";

export type UiContextMenuCloseReason = "select" | "outside" | "escape" | "scroll" | "resize";

export interface UiContextMenuAnchor {
  x: number;
  y: number;
  /** 向上翻转时的基准 y（如键盘触发时所在行的顶部）；缺省用 y 本身。 */
  aboveY?: number;
  /** 把 x 视为菜单右缘（跟随触发器右对齐）。 */
  alignRight?: boolean;
  /** 打开后是否聚焦首个可用条目，默认 true。 */
  focus?: boolean;
}

export interface UiContextMenuSubmenuSpec {
  items?: UiContextMenuItem[];
  /** 懒加载条目；同一 spec 对象在菜单会话内只请求一次。 */
  load?: () => Promise<UiContextMenuItem[]>;
  loadingLabel?: string;
  errorLabel?: string;
  emptyLabel?: string;
  label?: string;
  /** 固定在滚动区底部的条目（如"选择其他应用"）。 */
  footer?: UiContextMenuItem;
}

export type UiContextMenuItem =
  | { type: "separator" }
  | {
      type: "item";
      key: string;
      label?: string;
      icon?: Component;
      iconUrl?: string;
      iconSize?: number;
      iconClass?: string;
      danger?: boolean;
      disabled?: boolean;
      title?: string;
      checked?: boolean;
      /** 行内次级文本（等宽字体），点击触发 onActivate 且不关闭菜单，如复制分支名。 */
      meta?: { text: string; title?: string; onActivate?: () => void };
      /** 行尾弱化徽标（如待办计数），仅普通条目可用。 */
      trailing?: { text: string; title?: string };
      onSelect?: () => void;
      submenu?: UiContextMenuSubmenuSpec;
    };

export type UiContextMenuItemEntry = Extract<UiContextMenuItem, { type: "item" }>;

export interface UiContextMenuClosePayload {
  reason: UiContextMenuCloseReason;
  event?: Event;
}
