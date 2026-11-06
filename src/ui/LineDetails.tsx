import type { TicketLine } from '../domain';

/** Options and note for a line, shared by the bill and the kitchen ticket. */
export function LineDetails({ line }: { line: TicketLine }) {
  return (
    <>
      {line.options.length > 0 && (
        <div className="line-options">
          {line.options.map((option) => option.choiceName).join('、')}
        </div>
      )}
      {line.note && <div className="line-note">備註：{line.note}</div>}
    </>
  );
}
