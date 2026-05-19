import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const scrollBoundaryThreshold = 1;

export function findNearestScrollContainer(element: HTMLElement | null) {
  let current = element?.parentElement || null;
  while (current) {
    const style = window.getComputedStyle(current);
    const canScroll = /(auto|scroll|overlay)/.test(style.overflowY) && current.scrollHeight > current.clientHeight;
    if (canScroll) {
      return current;
    }
    current = current.parentElement;
  }

  const documentScroller = document.scrollingElement;
  if (documentScroller instanceof HTMLElement && documentScroller.scrollHeight > documentScroller.clientHeight) {
    return documentScroller;
  }

  return null;
}

export function transferWheelAtScrollBoundary(event: WheelEvent, element: HTMLElement | null) {
  if (!element || event.deltaY === 0) {
    return false;
  }

  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  const atTop = element.scrollTop <= scrollBoundaryThreshold;
  const atBottom = maxScrollTop - element.scrollTop <= scrollBoundaryThreshold;
  const cannotScroll = maxScrollTop <= scrollBoundaryThreshold;
  const shouldPassToOuter = cannotScroll || (event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom);
  if (!shouldPassToOuter) {
    return false;
  }

  const outer = findNearestScrollContainer(element);
  if (!outer) {
    return false;
  }

  event.preventDefault();
  outer.scrollTop += event.deltaY;
  return true;
}

export function scrollToBoundary(element: HTMLElement | null, boundary: "top" | "bottom") {
  if (!element) {
    return;
  }

  element.scrollTop = boundary === "top" ? 0 : element.scrollHeight;
}
