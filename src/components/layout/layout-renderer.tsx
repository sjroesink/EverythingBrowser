import { useCallback } from "react";
import { Group, Panel } from "react-resizable-panels";
import { PaneView } from "./pane-view";
import { ResizeHandle } from "./resize-handle";
import { useLayoutStore } from "@/stores/use-layout-store";
import type { LayoutNode } from "@/stores/use-layout-store";
import type { SavedConnection } from "@/types/connection";

interface LayoutRendererProps {
  node: LayoutNode;
  savedConnections: SavedConnection[];
}

export function LayoutRenderer({ node, savedConnections }: LayoutRendererProps) {
  if (node.type === "pane") {
    return <PaneView paneId={node.id} savedConnections={savedConnections} />;
  }

  return (
    <SplitView
      node={node}
      savedConnections={savedConnections}
    />
  );
}

function SplitView({
  node,
  savedConnections,
}: {
  node: Extract<LayoutNode, { type: "split" }>;
  savedConnections: SavedConnection[];
}) {
  const updateSizes = useLayoutStore((s) => s.updateSizes);

  // Panel IDs derived from split node for stable layout tracking
  const leftPanelId = `${node.id}-left`;
  const rightPanelId = `${node.id}-right`;

  const handleLayoutChanged = useCallback(
    (layout: { [id: string]: number }) => {
      const left = layout[leftPanelId];
      const right = layout[rightPanelId];
      if (left !== undefined && right !== undefined) {
        updateSizes(node.id, [left, right]);
      }
    },
    [node.id, leftPanelId, rightPanelId, updateSizes]
  );

  const defaultLayout = {
    [leftPanelId]: node.sizes[0],
    [rightPanelId]: node.sizes[1],
  };

  return (
    <Group
      orientation={node.direction}
      onLayoutChanged={handleLayoutChanged}
      defaultLayout={defaultLayout}
      className="h-full"
    >
      <Panel id={leftPanelId} defaultSize={`${node.sizes[0]}%`} minSize="15%">
        <LayoutRenderer node={node.children[0]} savedConnections={savedConnections} />
      </Panel>

      <ResizeHandle direction={node.direction} />

      <Panel id={rightPanelId} defaultSize={`${node.sizes[1]}%`} minSize="15%">
        <LayoutRenderer node={node.children[1]} savedConnections={savedConnections} />
      </Panel>
    </Group>
  );
}
