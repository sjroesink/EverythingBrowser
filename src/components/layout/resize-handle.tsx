import { Separator } from "react-resizable-panels";

interface ResizeHandleProps {
  direction: "horizontal" | "vertical";
}

export function ResizeHandle({ direction }: ResizeHandleProps) {
  const isHorizontal = direction === "horizontal";

  return (
    <Separator
      className={`group relative flex items-center justify-center
        ${isHorizontal ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"}
        bg-border hover:bg-primary/40 active:bg-primary/60 transition-colors`}
    >
      <div
        className={`rounded-full bg-muted-foreground/30 group-hover:bg-primary/60 group-active:bg-primary transition-colors
          ${isHorizontal ? "w-0.5 h-6" : "h-0.5 w-6"}`}
      />
    </Separator>
  );
}
