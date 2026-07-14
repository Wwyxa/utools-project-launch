const baseUrl = "http://localhost:3422/";
const targets = await fetch("http://localhost:9333/json/list").then((response) => response.json());
const target = targets.find((item) => item.type === "page");

if (!target) {
  throw new Error("No Chrome page target is available");
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let commandId = 0;
const pendingCommands = new Map();
const eventWaiters = new Map();

socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const pending = pendingCommands.get(message.id);
    if (!pending) return;
    pendingCommands.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
    return;
  }

  const waiters = eventWaiters.get(message.method) || [];
  eventWaiters.delete(message.method);
  waiters.forEach((resolve) => resolve(message.params));
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++commandId;
    pendingCommands.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

const waitForEvent = (method) =>
  new Promise((resolve) => {
    const waiters = eventWaiters.get(method) || [];
    waiters.push(resolve);
    eventWaiters.set(method, waiters);
  });

const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const rectExpression = `(() => {
  const rect = (selector) => {
    const value = document.querySelector(selector).getBoundingClientRect();
    return Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, Number(value[key].toFixed(3))]));
  };
  const actionRegion = document.querySelector('.dashboard-action-region');
  const actionsLayer = actionRegion.querySelector('.dashboard-actions-layer');
  const actionRow = actionRegion.querySelector('.dashboard-action-row');
  const actionButtons = actionRow.querySelectorAll('button');
  const actionRegionRect = actionRegion.getBoundingClientRect();
  const firstActionRect = actionButtons[0].getBoundingClientRect();
  const lastActionRect = actionButtons[actionButtons.length - 1].getBoundingClientRect();
  const toolbar = document.querySelector('.dashboard-toolbar');
  return {
    row: rect('.dashboard-toolbar-row'),
    group: rect('.dashboard-group-region'),
    right: rect('.dashboard-action-region'),
    visual: (() => {
      const searchStyle = getComputedStyle(actionRegion.querySelector('.dashboard-search-layer'));
      const actionsStyle = getComputedStyle(actionsLayer);
      return {
        searchOpacity: Number(searchStyle.opacity),
        searchTranslate: searchStyle.translate,
        searchTransitionProperty: searchStyle.transitionProperty,
        actionsOpacity: Number(actionsStyle.opacity),
        actionsTranslate: actionsStyle.translate,
        actionsTransitionProperty: actionsStyle.transitionProperty,
      };
    })(),
    actionOverflow: {
      regionClientWidth: actionRegion.clientWidth,
      regionScrollWidth: actionRegion.scrollWidth,
      layerClientWidth: actionsLayer.clientWidth,
      layerScrollWidth: actionsLayer.scrollWidth,
      layerClientHeight: actionsLayer.clientHeight,
      layerOffsetHeight: actionsLayer.offsetHeight,
      layerOverflowX: getComputedStyle(actionsLayer).overflowX,
      intrinsicRowWidth: Number(actionRow.getBoundingClientRect().width.toFixed(3)),
      firstActionFits: firstActionRect.left >= actionRegionRect.left - 0.01,
      lastActionFits: lastActionRect.right <= actionRegionRect.right + 0.01,
    },
    toolbarOverflow: {
      clientWidth: toolbar.clientWidth,
      scrollWidth: toolbar.scrollWidth,
      overflowX: getComputedStyle(toolbar).overflowX,
    },
    page: {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    },
    groupOverflow: (() => {
      const group = document.querySelector('.dashboard-group-region');
      return {
        clientWidth: group.clientWidth,
        scrollWidth: group.scrollWidth,
        clientHeight: group.clientHeight,
        offsetHeight: group.offsetHeight,
        overflowX: getComputedStyle(group).overflowX,
        overflowY: getComputedStyle(group).overflowY,
        scrollbarWidth: getComputedStyle(group).scrollbarWidth,
      };
    })(),
  };
})()`;

const clickPoint = async ({ x, y }) => {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
};

const navigate = async ({ key, width, deviceScaleFactor }) => {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height: 800,
    deviceScaleFactor,
    mobile: false,
  });
  const loaded = waitForEvent("Page.loadEventFired");
  await send("Page.navigate", { url: `${baseUrl}?browser-check=${key}-${Date.now()}` });
  await loaded;
  await evaluate(`new Promise((resolve, reject) => {
    const started = performance.now();
    const check = () => {
      if (document.querySelector('.dashboard-toolbar-row')) resolve(true);
      else if (performance.now() - started > 5000) reject(new Error('Dashboard toolbar did not render'));
      else requestAnimationFrame(check);
    };
    check();
  })`);
};

const actionState = () =>
  evaluate(`(() => {
    const actionRegion = document.querySelector('.dashboard-action-region');
    const searchLayer = actionRegion.querySelector('.dashboard-search-layer');
    const actionsLayer = actionRegion.querySelector('.dashboard-actions-layer');
    const input = searchLayer.querySelector('input[type="search"]');
    return {
      expanded: searchLayer.getAttribute('aria-hidden') === 'false',
      query: input.value,
      inputType: input.type,
      activeIsInput: document.activeElement === input,
      activeIsDefaultSearch: document.activeElement === actionsLayer.querySelector('button'),
      activeElementId: document.activeElement?.id || '',
      selectedGroupTitle: document.querySelector('.dashboard-filter-chip[aria-pressed="true"]')?.title || '',
      pointerdownListenerCount: window.__dashboardCheckPointerdownListeners?.size ?? null,
      searchLayerInert: searchLayer.inert,
      actionsLayerInert: actionsLayer.inert,
      searchLayerButtonCount: searchLayer.querySelectorAll('button').length,
      trailingCustomCloseCount: searchLayer.querySelectorAll('svg.lucide-x').length,
      leadingButtonIsLeft: searchLayer.querySelector('button').getBoundingClientRect().right < input.getBoundingClientRect().left + input.getBoundingClientRect().width / 2,
      visibleProjectNames: Array.from(document.querySelectorAll('h3')).map((heading) => heading.textContent.trim()),
    };
  })()`);

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => {
    const listeners = new Set();
    const addEventListener = Document.prototype.addEventListener;
    const removeEventListener = Document.prototype.removeEventListener;
    Object.defineProperty(window, '__dashboardCheckPointerdownListeners', { value: listeners });
    Document.prototype.addEventListener = function(type, listener, options) {
      if (this === document && type === 'pointerdown') listeners.add(listener);
      return addEventListener.call(this, type, listener, options);
    };
    Document.prototype.removeEventListener = function(type, listener, options) {
      if (this === document && type === 'pointerdown') listeners.delete(listener);
      return removeEventListener.call(this, type, listener, options);
    };
  })();`,
});

const viewportResults = {};

const viewportCases = [
  { key: "1280@1", width: 1280, deviceScaleFactor: 1 },
  { key: "640@1", width: 640, deviceScaleFactor: 1 },
  { key: "512@1.25", width: 512, deviceScaleFactor: 1.25 },
  { key: "400@1.25", width: 400, deviceScaleFactor: 1.25 },
];

for (const viewport of viewportCases) {
  await navigate(viewport);
  const groupFilterSetup = await evaluate(`(() => {
    const chips = document.querySelectorAll('.dashboard-filter-chip');
    chips[1]?.click();
    return { selectedGroupTitle: chips[1]?.title || chips[0]?.title || '' };
  })()`);
  await delay(30);
  groupFilterSetup.visibleProjectNames = await evaluate(
    `Array.from(document.querySelectorAll('h3')).map((heading) => heading.textContent.trim())`,
  );
  const before = await evaluate(rectExpression);
  const toolbarScrollAttempt = await evaluate(`(() => {
    const toolbar = document.querySelector('.dashboard-toolbar');
    const before = toolbar.scrollLeft;
    toolbar.scrollLeft = toolbar.scrollWidth;
    return {
      before,
      after: toolbar.scrollLeft,
      clientWidth: toolbar.clientWidth,
      scrollWidth: toolbar.scrollWidth,
      clientHeight: toolbar.clientHeight,
      offsetHeight: toolbar.offsetHeight,
      scrollbarThickness: toolbar.offsetHeight - toolbar.clientHeight,
      overflowX: getComputedStyle(toolbar).overflowX,
    };
  })()`);
  const closedState = await actionState();

  await evaluate(`(() => {
    document.querySelector('.dashboard-actions-layer button').click();
  })()`);
  await delay(75);
  const openingMid = await evaluate(rectExpression);
  await delay(125);
  const openAfter = await evaluate(rectExpression);
  const openState = await actionState();

  const inputRect = await evaluate(`(() => {
    const rect = document.querySelector('.dashboard-action-region input[type="search"]').getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`);
  await clickPoint({ x: inputRect.x + inputRect.width / 2, y: inputRect.y + inputRect.height / 2 });
  await delay(30);
  const insidePointerState = await actionState();

  const queryText = await evaluate(`(() => {
    const name = document.querySelector('h3')?.textContent?.trim() || 'src';
    return name.slice(0, Math.min(3, name.length));
  })()`);
  await send("Input.insertText", { text: queryText });
  await delay(50);
  const queryState = await actionState();
  const nativeClearAttempts = [];
  for (const offset of [6, 10, 14, 18, 22, 26, 30, 34]) {
    await evaluate(`(() => {
      const input = document.querySelector('.dashboard-action-region input[type="search"]');
      input.value = 'src';
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'src' }));
      input.focus();
    })()`);
    await clickPoint({ x: inputRect.x + inputRect.width - offset, y: inputRect.y + inputRect.height / 2 });
    await delay(30);
    const value = await evaluate(`document.querySelector('.dashboard-action-region input[type="search"]').value`);
    nativeClearAttempts.push({ offset, value });
    if (value === "") break;
  }
  const nativeClearState = await actionState();

  await evaluate(`(() => document.querySelector('.dashboard-action-region input[type="search"]').focus())()`);
  await send("Input.insertText", { text: queryText });
  await delay(50);
  const preservedQueryState = await actionState();

  const leadingRect = await evaluate(`(() => {
    const button = document.querySelector('.dashboard-search-layer button');
    const rect = button.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`);
  await clickPoint({ x: leadingRect.x + leadingRect.width / 2, y: leadingRect.y + leadingRect.height / 2 });
  await delay(75);
  const closingMid = await evaluate(rectExpression);
  await delay(125);
  const closedAfter = await evaluate(rectExpression);
  const leadingCollapseState = await actionState();

  await evaluate(`(() => {
    const button = document.createElement('button');
    button.id = 'dashboard-check-outside-target';
    button.textContent = 'outside';
    Object.assign(button.style, { position: 'fixed', left: '2px', top: '80px', zIndex: '9999' });
    document.body.append(button);
  })()`);
  await evaluate(`(() => {
    document.querySelector('.dashboard-actions-layer button').click();
  })()`);
  await delay(200);
  const outsideButtonRect = await evaluate(`(() => {
    const rect = document.querySelector('#dashboard-check-outside-target').getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`);
  await clickPoint({
    x: outsideButtonRect.x + outsideButtonRect.width / 2,
    y: outsideButtonRect.y + outsideButtonRect.height / 2,
  });
  await delay(200);
  const outsideCollapseState = await actionState();
  await evaluate(`document.querySelector('#dashboard-check-outside-target').remove()`);

  await evaluate(`(() => {
    document.querySelector('.dashboard-actions-layer button').click();
  })()`);
  await delay(200);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await delay(200);
  const escapeCollapseState = await actionState();

  const refreshResult = await evaluate(`new Promise((resolve, reject) => {
    const actionsLayer = document.querySelector('.dashboard-actions-layer');
    const button = actionsLayer.querySelector('button:last-child').previousElementSibling;
    const rect = () => {
      const value = button.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height };
    };
    const before = rect();
    button.click();
    requestAnimationFrame(() => {
      const during = { rect: rect(), disabled: button.disabled, spinning: button.querySelector('svg').classList.contains('animate-spin') };
      const started = performance.now();
      const check = () => {
        if (!button.disabled) resolve({ before, during, after: rect() });
        else if (performance.now() - started > 5000) reject(new Error('Refresh did not settle'));
        else requestAnimationFrame(check);
      };
      check();
    });
  })`);

  const forcedGroupOverflowResult = await evaluate(`(() => {
    const group = document.querySelector('.dashboard-group-region');
    const row = group.firstElementChild;
    const right = document.querySelector('.dashboard-action-region');
    const actionsLayer = right.querySelector('.dashboard-actions-layer');
    const actionRow = right.querySelector('.dashboard-action-row');
    const toolbar = document.querySelector('.dashboard-toolbar');
    const rightBefore = right.getBoundingClientRect();
    const clones = [];
    for (let index = 0; index < 8; index += 1) {
      const clone = row.firstElementChild.cloneNode(true);
      clone.dataset.dashboardCheckClone = 'true';
      clone.querySelector('span').textContent = 'Forced overflow group ' + index;
      row.append(clone);
      clones.push(clone);
    }
    group.scrollLeft = group.scrollWidth;
    const rightAfter = right.getBoundingClientRect();
    const chipHeight = row.firstElementChild.getBoundingClientRect().height;
    const result = {
      clientWidth: group.clientWidth,
      scrollWidth: group.scrollWidth,
      clientHeight: group.clientHeight,
      offsetHeight: group.offsetHeight,
      chipHeight,
      scrollbarThickness: group.offsetHeight - group.clientHeight,
      scrollbarWidth: getComputedStyle(group).scrollbarWidth,
      overflowX: getComputedStyle(group).overflowX,
      scrollLeft: group.scrollLeft,
      rightStable: rightBefore.x === rightAfter.x && rightBefore.width === rightAfter.width,
      rightWidth: rightAfter.width,
      intrinsicActionRowWidth: actionRow.getBoundingClientRect().width,
      actionRegionClientWidth: right.clientWidth,
      actionRegionScrollWidth: right.scrollWidth,
      actionLayerClientWidth: actionsLayer.clientWidth,
      actionLayerScrollWidth: actionsLayer.scrollWidth,
      actionLayerOverflowX: getComputedStyle(actionsLayer).overflowX,
      toolbarClientWidth: toolbar.clientWidth,
      toolbarScrollWidth: toolbar.scrollWidth,
      pageContained: document.documentElement.scrollWidth === document.documentElement.clientWidth,
    };
    clones.forEach((clone) => clone.remove());
    return result;
  })()`);

  await evaluate(`(() => {
    document.querySelector('.dashboard-actions-layer button').click();
  })()`);
  await delay(200);
  const unmountOpenState = await actionState();
  await evaluate(`document.querySelector('h3').click()`);
  await evaluate(`new Promise((resolve, reject) => {
    const started = performance.now();
    const check = () => {
      if (!document.querySelector('.dashboard-toolbar-row')) resolve(true);
      else if (performance.now() - started > 2000) reject(new Error('Dashboard did not unmount'));
      else requestAnimationFrame(check);
    };
    check();
  })`);
  const unmountPointerdownListenerCount = await evaluate(`window.__dashboardCheckPointerdownListeners.size`);

  viewportResults[viewport.key] = {
    viewport,
    geometry: { before, openingMid, openAfter, closingMid, closedAfter },
    toolbarScrollAttempt,
    groupFilterSetup,
    closedState,
    openState,
    insidePointerState,
    queryText,
    queryState,
    nativeClearAttempts,
    nativeClearState,
    preservedQueryState,
    leadingCollapseState,
    outsideCollapseState,
    escapeCollapseState,
    refreshResult,
    forcedGroupOverflowResult,
    unmountOpenState,
    unmountPointerdownListenerCount,
  };
}

await navigate({ key: "320@1", width: 320, deviceScaleFactor: 1 });
const compactResult = await evaluate(`(() => {
  const toolbar = document.querySelector('.dashboard-toolbar');
  const right = document.querySelector('.dashboard-action-region');
  const actionsLayer = right.querySelector('.dashboard-actions-layer');
  const actionRow = right.querySelector('.dashboard-action-row');
  const firstButtonRect = actionRow.querySelector('button:first-child').getBoundingClientRect();
  const lastButtonRectAtStart = actionRow.querySelector('button:last-child').getBoundingClientRect();
  const toolbarRectAtStart = toolbar.getBoundingClientRect();
  const firstActionVisibleAtStart =
    firstButtonRect.left >= toolbarRectAtStart.left && firstButtonRect.right <= toolbarRectAtStart.right;
  toolbar.scrollLeft = toolbar.scrollWidth;
  const toolbarRect = toolbar.getBoundingClientRect();
  const lastButtonRect = actionRow.querySelector('button:last-child').getBoundingClientRect();
  return {
    pageClientWidth: document.documentElement.clientWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    toolbarClientWidth: toolbar.clientWidth,
    toolbarScrollWidth: toolbar.scrollWidth,
    toolbarScrollLeft: toolbar.scrollLeft,
    toolbarClientHeight: toolbar.clientHeight,
    toolbarOffsetHeight: toolbar.offsetHeight,
    toolbarScrollbarThickness: toolbar.offsetHeight - toolbar.clientHeight,
    toolbarOverflowX: getComputedStyle(toolbar).overflowX,
    rightWidth: right.getBoundingClientRect().width,
    intrinsicActionRowWidth: actionRow.getBoundingClientRect().width,
    actionRegionClientWidth: right.clientWidth,
    actionRegionScrollWidth: right.scrollWidth,
    actionLayerClientWidth: actionsLayer.clientWidth,
    actionLayerScrollWidth: actionsLayer.scrollWidth,
    actionLayerOverflowX: getComputedStyle(actionsLayer).overflowX,
    firstActionVisibleAtStart,
    lastActionVisibleAtStart:
      lastButtonRectAtStart.left >= toolbarRectAtStart.left && lastButtonRectAtStart.right <= toolbarRectAtStart.right,
    lastActionVisibleAfterScroll: lastButtonRect.left >= toolbarRect.left && lastButtonRect.right <= toolbarRect.right,
    clippedActionPixels: Number(Math.max(0, lastButtonRectAtStart.right - toolbarRectAtStart.right).toFixed(3)),
  };
})()`);

const geometryKeys = ["x", "y", "width", "height"];
const failures = [];
for (const [label, result] of Object.entries(viewportResults)) {
  const geometryStates = Object.values(result.geometry);
  for (const region of ["row", "group", "right"]) {
    for (const key of geometryKeys) {
      if (!geometryStates.every((state) => state[region][key] === geometryStates[0][region][key])) {
        failures.push(`${label} ${region}.${key} changed during transition`);
      }
    }
  }
  for (const state of geometryStates) {
    if (Math.abs(state.right.width - state.actionOverflow.intrinsicRowWidth) > 0.01)
      failures.push(`${label} action width does not equal intrinsic row width`);
    if (state.actionOverflow.regionClientWidth !== state.actionOverflow.regionScrollWidth)
      failures.push(`${label} action region owns horizontal overflow`);
    if (state.actionOverflow.layerClientWidth !== state.actionOverflow.layerScrollWidth)
      failures.push(`${label} action layer owns horizontal overflow`);
    if (["auto", "scroll"].includes(state.actionOverflow.layerOverflowX))
      failures.push(`${label} action layer enables horizontal scrolling`);
    if (state.actionOverflow.layerClientHeight !== state.actionOverflow.layerOffsetHeight)
      failures.push(`${label} action layer has a scrollbar under its buttons`);
  }
  if (!result.geometry.before.actionOverflow.firstActionFits || !result.geometry.before.actionOverflow.lastActionFits)
    failures.push(`${label} default action endpoints do not fit inside the action region`);
  if (result.geometry.before.page.scrollWidth !== result.geometry.before.page.clientWidth)
    failures.push(`${label} page overflowed`);
  if (result.geometry.before.toolbarOverflow.scrollWidth !== result.geometry.before.toolbarOverflow.clientWidth)
    failures.push(`${label} outer toolbar overflowed`);
  if (!["clip", "hidden"].includes(result.toolbarScrollAttempt.overflowX))
    failures.push(`${label} outer toolbar overflow is scrollable`);
  if (result.toolbarScrollAttempt.after !== 0)
    failures.push(`${label} outer toolbar responded to horizontal scrolling`);
  if (result.toolbarScrollAttempt.scrollbarThickness !== 0)
    failures.push(`${label} outer toolbar exposes a horizontal scrollbar`);
  if (result.geometry.before.groupOverflow.overflowX !== "auto")
    failures.push(`${label} group region does not own horizontal overflow`);
  if (
    result.groupFilterSetup.selectedGroupTitle &&
    result.closedState.selectedGroupTitle !== result.groupFilterSetup.selectedGroupTitle
  )
    failures.push(`${label} group filter setup did not persist`);
  if (result.closedState.actionsLayerInert) failures.push(`${label} closed action layer is inert`);
  if (!result.closedState.searchLayerInert) failures.push(`${label} closed search layer is focusable`);
  if (!result.openState.actionsLayerInert || result.openState.searchLayerInert)
    failures.push(`${label} open hidden-layer inert state is wrong`);
  if (result.openState.pointerdownListenerCount !== result.closedState.pointerdownListenerCount + 1)
    failures.push(`${label} pointerdown listener was not added once`);
  if (!result.insidePointerState.expanded) failures.push(`${label} inside pointerdown collapsed search`);
  if (result.insidePointerState.pointerdownListenerCount !== result.openState.pointerdownListenerCount)
    failures.push(`${label} inside pointerdown changed listener lifecycle`);
  if (result.leadingCollapseState.pointerdownListenerCount !== result.closedState.pointerdownListenerCount)
    failures.push(`${label} leading collapse leaked pointerdown listener`);
  if (result.outsideCollapseState.activeElementId !== "dashboard-check-outside-target")
    failures.push(`${label} outside pointerdown stole focus`);
  if (result.outsideCollapseState.pointerdownListenerCount !== result.closedState.pointerdownListenerCount)
    failures.push(`${label} outside collapse leaked pointerdown listener`);
  if (!result.escapeCollapseState.activeIsDefaultSearch)
    failures.push(`${label} Escape did not restore search-button focus`);
  if (result.escapeCollapseState.pointerdownListenerCount !== result.closedState.pointerdownListenerCount)
    failures.push(`${label} Escape collapse leaked pointerdown listener`);
  if (result.openState.searchLayerButtonCount !== 1 || result.openState.trailingCustomCloseCount !== 0)
    failures.push(`${label} search layer has a trailing custom close`);
  if (!result.nativeClearAttempts.some((attempt) => attempt.value === ""))
    failures.push(`${label} native search clear was unusable`);
  if (result.leadingCollapseState.query !== result.queryText)
    failures.push(`${label} query was not preserved on collapse`);
  if (
    result.leadingCollapseState.visibleProjectNames.join("|") !==
    result.preservedQueryState.visibleProjectNames.join("|")
  )
    failures.push(`${label} filtered results changed on collapse`);
  if (
    !result.queryState.visibleProjectNames.every((name) => result.groupFilterSetup.visibleProjectNames.includes(name))
  )
    failures.push(`${label} search escaped the selected group filter`);
  if (result.leadingCollapseState.selectedGroupTitle !== result.groupFilterSetup.selectedGroupTitle)
    failures.push(`${label} selected group changed on search collapse`);
  if (!result.refreshResult.during.disabled || !result.refreshResult.during.spinning)
    failures.push(`${label} refresh loading state was not observable`);
  if (
    JSON.stringify(result.refreshResult.before) !== JSON.stringify(result.refreshResult.during.rect) ||
    JSON.stringify(result.refreshResult.before) !== JSON.stringify(result.refreshResult.after)
  )
    failures.push(`${label} refresh button geometry changed`);
  if (
    result.forcedGroupOverflowResult.scrollWidth <= result.forcedGroupOverflowResult.clientWidth ||
    result.forcedGroupOverflowResult.scrollLeft <= 0
  )
    failures.push(`${label} forced group overflow was not locally scrollable`);
  if (
    result.forcedGroupOverflowResult.scrollbarThickness <= 0 ||
    result.forcedGroupOverflowResult.scrollbarThickness > 6 ||
    result.forcedGroupOverflowResult.overflowX !== "auto"
  )
    failures.push(`${label} forced group overflow does not expose a thin owned scrollbar`);
  if (result.forcedGroupOverflowResult.clientHeight < result.forcedGroupOverflowResult.chipHeight)
    failures.push(`${label} group scrollbar clips the 28px chips`);
  if (!result.forcedGroupOverflowResult.rightStable || !result.forcedGroupOverflowResult.pageContained)
    failures.push(`${label} forced group overflow moved the right region or page`);
  if (
    result.forcedGroupOverflowResult.actionRegionClientWidth !==
      result.forcedGroupOverflowResult.actionRegionScrollWidth ||
    result.forcedGroupOverflowResult.actionLayerClientWidth !==
      result.forcedGroupOverflowResult.actionLayerScrollWidth ||
    ["auto", "scroll"].includes(result.forcedGroupOverflowResult.actionLayerOverflowX) ||
    result.forcedGroupOverflowResult.toolbarClientWidth !== result.forcedGroupOverflowResult.toolbarScrollWidth
  )
    failures.push(`${label} forced group overflow leaked into the action region or outer toolbar`);
  if (
    Math.abs(result.forcedGroupOverflowResult.rightWidth - result.forcedGroupOverflowResult.intrinsicActionRowWidth) >
    0.01
  )
    failures.push(`${label} forced group overflow changed intrinsic action width`);
  if (result.unmountOpenState.pointerdownListenerCount !== result.closedState.pointerdownListenerCount + 1)
    failures.push(`${label} unmount check did not begin expanded`);
  if (result.unmountPointerdownListenerCount !== result.closedState.pointerdownListenerCount)
    failures.push(`${label} unmount leaked pointerdown listener`);
  for (const state of geometryStates) {
    if (
      state.visual.searchTransitionProperty !== "opacity, translate" ||
      state.visual.actionsTransitionProperty !== "opacity, translate"
    )
      failures.push(`${label} transition property is not limited to opacity and translate`);
  }
}
if (compactResult.pageScrollWidth !== compactResult.pageClientWidth) failures.push("320px page overflowed");
if (!["clip", "hidden"].includes(compactResult.toolbarOverflowX))
  failures.push("320px outer toolbar overflow is scrollable");
if (compactResult.toolbarScrollLeft !== 0) failures.push("320px outer toolbar responded to horizontal scrolling");
if (compactResult.toolbarScrollbarThickness !== 0) failures.push("320px outer toolbar exposes a horizontal scrollbar");
if (Math.abs(compactResult.rightWidth - compactResult.intrinsicActionRowWidth) > 0.01)
  failures.push("320px action width does not equal intrinsic row width");
if (
  compactResult.actionRegionClientWidth !== compactResult.actionRegionScrollWidth ||
  compactResult.actionLayerClientWidth !== compactResult.actionLayerScrollWidth ||
  ["auto", "scroll"].includes(compactResult.actionLayerOverflowX)
)
  failures.push("320px action region has internal horizontal overflow");
if (!compactResult.firstActionVisibleAtStart) failures.push("320px action row is clipped at its leading edge");
if (compactResult.lastActionVisibleAfterScroll !== compactResult.lastActionVisibleAtStart)
  failures.push("320px outer toolbar scrolling changed action visibility");

const output = { viewports: viewportResults, compact: compactResult, failures };
console.log(JSON.stringify(output, null, 2));
socket.close();
if (failures.length > 0) process.exitCode = 1;
