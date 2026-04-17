import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type ScrollFollowMode = "pinned-start" | "pinned-end" | "detached";

function isNearBottom(element: HTMLDivElement | null) {
  if (!element) {
    return true;
  }

  return element.scrollHeight - element.scrollTop - element.clientHeight <= 32;
}

function scrollToBottom(element: HTMLDivElement | null) {
  if (!element) {
    return;
  }

  const top = element.scrollHeight;
  if (typeof element.scrollTo === "function") {
    try {
      element.scrollTo({ top, behavior: "smooth" });
      return;
    } catch {
      // Fall through for environments that don't support ScrollToOptions.
    }
  }

  element.scrollTop = top;
}

function scrollToMessageStart(container: HTMLDivElement | null, target: HTMLElement | null) {
  if (!container || !target) {
    return;
  }

  const top = target.offsetTop;
  if (typeof container.scrollTo === "function") {
    try {
      container.scrollTo({ top, behavior: "smooth" });
      return;
    } catch {
      // Fall through for environments that don't support ScrollToOptions.
    }
  }

  container.scrollTop = top;
}

// @ArchitectureID: ELM-REQ-OPENCODE-UX
// @SoftwareUnitID: SU-SP-SCROLL-FOLLOW-CONTROLLER
export function useScrollFollowController({
  containerRef,
  activeMessageRef,
  live,
  contentRevision,
  activeMessageId
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  activeMessageRef: RefObject<HTMLElement | null>;
  live: boolean;
  contentRevision: string;
  activeMessageId?: string | null;
}) {
  const [mode, setMode] = useState<ScrollFollowMode>(live ? "pinned-start" : "detached");
  const [showLatestMessageButton, setShowLatestMessageButton] = useState(false);
  const previousContentRevisionRef = useRef(contentRevision);
  const previousActiveMessageIdRef = useRef(activeMessageId ?? null);

  useEffect(() => {
    if (!live) {
      setMode("detached");
      setShowLatestMessageButton(false);
      return;
    }

    setMode((currentMode) => currentMode === "detached" ? currentMode : (currentMode ?? "pinned-start"));
  }, [live]);

  useEffect(() => {
    const previousActiveMessageId = previousActiveMessageIdRef.current;
    previousActiveMessageIdRef.current = activeMessageId ?? null;

    if (!live || !activeMessageId || previousActiveMessageId === activeMessageId || mode === "detached") {
      return;
    }

    setMode("pinned-start");
    requestAnimationFrame(() => {
      scrollToMessageStart(containerRef.current, activeMessageRef.current);
    });
    setShowLatestMessageButton(false);
  }, [activeMessageId, activeMessageRef, containerRef, live, mode]);

  useEffect(() => {
    const changed = previousContentRevisionRef.current !== contentRevision;
    previousContentRevisionRef.current = contentRevision;
    if (!changed || !live) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    if (mode === "pinned-start") {
      requestAnimationFrame(() => {
        scrollToMessageStart(containerRef.current, activeMessageRef.current);
      });
      setShowLatestMessageButton(false);
      return;
    }

    if (mode === "pinned-end" || isNearBottom(container)) {
      requestAnimationFrame(() => {
        scrollToBottom(containerRef.current);
        requestAnimationFrame(() => {
          scrollToBottom(containerRef.current);
        });
      });
      setMode("pinned-end");
      setShowLatestMessageButton(false);
      return;
    }

    setShowLatestMessageButton(true);
  }, [containerRef, contentRevision, live, mode]);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    const pinned = isNearBottom(container);
    setMode(pinned ? "pinned-end" : "detached");
    if (pinned) {
      setShowLatestMessageButton(false);
    }
  }, [containerRef]);

  const resumeFollow = useCallback(() => {
    requestAnimationFrame(() => {
      scrollToBottom(containerRef.current);
      requestAnimationFrame(() => {
        scrollToBottom(containerRef.current);
      });
    });
    setMode("pinned-end");
    setShowLatestMessageButton(false);
  }, [containerRef]);

  return {
    mode,
    isDetached: mode === "detached",
    showLatestMessageButton,
    handleScroll,
    resumeFollow
  };
}
