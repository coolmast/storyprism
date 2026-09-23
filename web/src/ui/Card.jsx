export default function Card({ as: Tag = "div", className = "", children, ...rest }) {
  return (
    <Tag className={`ui-card ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}
