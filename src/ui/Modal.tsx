import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose(): void;
  children: ReactNode;
  footer: ReactNode;
}

export function Modal({ title, onClose, children, footer }: ModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="modal-header">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="關閉">×</button>
      </header>
      <div className="modal-body">{children}</div>
      <footer className="modal-footer">{footer}</footer>
    </dialog>
  );
}
