// The shared render state of one renderTimelineView pass (task 92 split). renderTimelineView
// builds one TimelineRenderContext and hands it to every timeline-render-* module function; the
// function-valued members are assigned by renderTimelineView after construction so the extracted
// groups can call each other without import cycles.
export {};
