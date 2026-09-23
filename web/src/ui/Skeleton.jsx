// Shaped like the content that's coming, never a blank screen or a bare
// spinner for anything longer than instant (brief item 3). Pass width/
// height/borderRadius etc. via style to match what it's standing in for.
export default function Skeleton({ className = "", style }) {
  return <div className={`ui-skeleton ${className}`.trim()} style={style} aria-hidden="true" />;
}
