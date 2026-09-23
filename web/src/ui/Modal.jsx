import { useEffect, useRef } from "react";

// One dialog primitive adapting by breakpoint - centered on desktop,
// bottom sheet on mobile (see ui.css) - for confirmations, secondary
// forms and menus, not full page navigation (brief item 3).
export default function Modal({ open, onClose, title, children, footer }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleCancel = (e) => {
      e.preventDefault();
      onClose();
    };
    const handleClick = (e) => {
      if (e.target === dialog) onClose();
    };
    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("click", handleClick);
    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("click", handleClick);
    };
  }, [onClose]);

  return (
    <dialog ref={ref} className="ui-modal" onClose={onClose}>
      {title && <h2 className="ui-modal-title">{title}</h2>}
      <div className="ui-modal-body">{children}</div>
      {footer && <div className="ui-modal-footer">{footer}</div>}
    </dialog>
  );
}
