import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type ScrollFollowMode = "pinned" | "detached";

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

  element.scrollTop = element.scrollHeight;
}

// @ArchitectureID: ELM-REQ-OPENCODE-UX
// @SoftwareUnitID: SU-SP-SCROLL-FOLLOW-CONTROLLER
export function useScrollFollowController({
  containerRef,
  live,
  contentRevision
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  live: boolean;
  contentRevision: string;
}) {
  const [mode, setMode] = useState<ScrollFollowMode>(live ? "pinned" : "detached");
  const [showLatestMessageButton, setShowLatestMessageButton] = useState(false);
  const previousContentRevisionRef = useRef(contentRevision);

  useEffect(() => {
    if (!live) {
      setMode("detached");
      setShowLatestMessageButton(false);
      return;
    }

    setMode((currentMode) => currentMode ?? "pinned");
  }, [live]);

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

    if (mode === "pinned" || isNearBottom(container)) {
      requestAnimationFrame(() => {
        scrollToBottom(containerRef.current);
      });
      setMode("pinned");
      setShowLatestMessageButton(false);
      return;
    }

    setShowLatestMessageButton(true);
  }, [containerRef, contentRevision, live, mode]);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    const pinned = isNearBottom(container);
    setMode(pinned ? "pinned" : "detached");
    if (pinned) {
      setShowLatestMessageButton(false);
    }
  }, [containerRef]);

  const resumeFollow = useCallback(() => {
    requestAnimationFrame(() => {
      scrollToBottom(containerRef.current);
    });
    setMode("pinned");
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
