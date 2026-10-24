/**
 * 浮层层栈：BaseModal / UiSelect 等地基浮层注册于此，解决两类问题——
 * 1. Escape 优先级：app-escape 监听按注册顺序触发，父组件（先挂载）会抢在
 *    子浮层（后挂载）之前消费事件；层栈让"可视最上层"优先响应。
 * 2. 焦点陷阱：叠加弹窗时只有最上层的 BaseModal 拦截 Tab。
 * 手写浮层（GitTab 各菜单、UiContextMenu 等）未接入层栈，仍走各自的
 * handled 链条；两类通过 handled 标志互不抢占。
 */

export interface UiLayer {
  close: () => void;
  /** false 表示该层拒绝关闭（如 busy 态），事件标记未处理继续传递。 */
  kind: "modal" | "floating";
}

const layers: UiLayer[] = [];

export const pushUiLayer = (layer: UiLayer) => {
  layers.push(layer);
  return () => removeUiLayer(layer);
};

export const removeUiLayer = (layer: UiLayer) => {
  const index = layers.lastIndexOf(layer);
  if (index >= 0) layers.splice(index, 1);
};

export const isTopUiLayer = (layer: UiLayer) => layers[layers.length - 1] === layer;

/** 最上层未处理的 modal 层（供焦点陷阱判断）。 */
export const isTopModalLayer = (layer: UiLayer) => {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    if (layers[index].kind === "modal") return layers[index] === layer;
  }
  return false;
};
