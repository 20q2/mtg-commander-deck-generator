import type { UserCardList } from '@/types';
import { CardTypeIcon, CommanderIcon } from '@/components/ui/mtg-icons';
import { stripMarkdown } from '@/lib/utils';
import { MoreHorizontal, CopyPlus, Download, Trash2, Pencil, List } from 'lucide-react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface ListCardProps {
  list: UserCardList;
  viewMode: 'grid' | 'list';
  typeBreakdown?: Record<string, number>;
  colorIdentity?: string[];
  commanderArtUrl?: string;
  onClick: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function ListCard({ list, viewMode, typeBreakdown, colorIdentity, commanderArtUrl, onClick, onEdit, onDuplicate, onExport, onDelete }: ListCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const updateMenuPos = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: rect.right });
    }
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const handleToggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!menuOpen) updateMenuPos();
    setMenuOpen(!menuOpen);
  };

  const previewCards = list.cards.slice(0, 4);
  const remainingCount = list.cards.length - previewCards.length;

  const dropdownPortal = menuOpen && menuPos && createPortal(
    <DropdownMenu
      ref={menuRef}
      position={menuPos}
      onEdit={onEdit}
      onDuplicate={onDuplicate}
      onExport={onExport}
      onDelete={onDelete}
      onClose={() => setMenuOpen(false)}
    />,
    document.body
  );

  if (viewMode === 'list') {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
        className="w-full flex items-center gap-4 px-4 py-3 hover:bg-accent/30 rounded-lg transition-colors text-left group relative cursor-pointer"
      >
        {commanderArtUrl ? (
          <img
            src={commanderArtUrl}
            alt=""
            className="w-14 h-10 rounded-md object-cover shrink-0"
          />
        ) : (
          <div className="w-14 h-10 rounded-md bg-accent/40 shrink-0 flex items-center justify-center">
            <List className="w-4 h-4 text-muted-foreground/40" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium group-hover:text-primary transition-colors truncate">{list.name}</span>
            {colorIdentity && (
              <span className="inline-flex items-center gap-0.5 shrink-0">
                {colorIdentity.length > 0
                  ? colorIdentity.map(c => (
                      <i key={c} className={`ms ms-${c.toLowerCase()} ms-cost text-xs`} />
                    ))
                  : <i className="ms ms-c ms-cost text-xs" />
                }
              </span>
            )}
            {(list.description || list.primer) && (
              <span className="text-xs text-muted-foreground truncate">{list.description || stripMarkdown(list.primer!)}</span>
            )}
          </div>
          {list.commanderName && (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
              <CommanderIcon size={11} className="shrink-0" />
              <span className="truncate">{list.commanderName}{list.partnerCommanderName ? ` & ${list.partnerCommanderName}` : ''}</span>
            </div>
          )}
        </div>
        {typeBreakdown && Object.keys(typeBreakdown).length > 0 ? (
          <div className="flex items-center gap-1 shrink-0">
            {Object.entries(typeBreakdown)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <span
                  key={type}
                  className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/70"
                  title={type}
                >
                  <CardTypeIcon type={type} size="sm" className="opacity-50 text-[10px]" />
                  {count}
                </span>
              ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground whitespace-nowrap">{list.cards.length} cards</span>
        )}
        <span className="text-xs text-muted-foreground/60 whitespace-nowrap w-16 text-right">{formatRelativeTime(list.updatedAt)}</span>
        <div className="relative">
          <button
            ref={buttonRef}
            onClick={handleToggleMenu}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {dropdownPortal}
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-4 hover:border-border transition-colors cursor-pointer group relative overflow-hidden flex flex-col"
      onClick={onClick}
    >
      {commanderArtUrl && (
        <div className="absolute inset-0 pointer-events-none">
          <img src={commanderArtUrl} alt="" className="w-full h-full object-cover opacity-[0.18]" />
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/60 to-transparent" />
        </div>
      )}
      <div className="relative flex flex-col flex-1">
      <div className="flex items-start justify-between mb-1">
        <h3 className="text-sm font-medium group-hover:text-primary transition-colors truncate pr-2">{list.name}</h3>
        <div className="relative">
          <button
            ref={buttonRef}
            onClick={handleToggleMenu}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {dropdownPortal}
        </div>
      </div>

      {list.commanderName ? (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5">
          <CommanderIcon size={11} className="shrink-0" />
          <span className="truncate">{list.commanderName}{list.partnerCommanderName ? ` & ${list.partnerCommanderName}` : ''}</span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5">
          <List className="w-[11px] h-[11px] shrink-0" />
          <span>List</span>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
        <span>{list.cards.length} cards</span>
        <span className="text-border">·</span>
        <span>{formatRelativeTime(list.updatedAt)}</span>
        {colorIdentity && (
          <>
            <span className="text-border">·</span>
            <span className="inline-flex items-center gap-0.5">
              {colorIdentity.length > 0
                ? colorIdentity.map(c => (
                    <i key={c} className={`ms ms-${c.toLowerCase()} ms-cost text-xs`} />
                  ))
                : <i className="ms ms-c ms-cost text-xs" />
              }
            </span>
          </>
        )}
      </div>

      {(list.description || list.primer) && (
        <p className="text-xs text-muted-foreground/80 mb-3 line-clamp-2">{list.description || stripMarkdown(list.primer!)}</p>
      )}

      {typeBreakdown && Object.keys(typeBreakdown).length > 0 ? (
        <div className="flex flex-wrap gap-1 mt-auto">
          {Object.entries(typeBreakdown)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => (
              <span
                key={type}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-accent/50 text-muted-foreground rounded border border-border/30"
              >
                <CardTypeIcon type={type} size="sm" className="opacity-60 text-[10px]" />
                {count}
              </span>
            ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1 mt-auto">
          {previewCards.map(name => (
            <span key={name} className="px-1.5 py-0.5 text-[10px] bg-accent/50 text-muted-foreground rounded border border-border/30 truncate max-w-[120px]">
              {name}
            </span>
          ))}
          {remainingCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
              +{remainingCount} more
            </span>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

import { forwardRef } from 'react';

const DropdownMenu = forwardRef<HTMLDivElement, {
  position: { top: number; left: number };
  onEdit: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
  onClose: () => void;
}>(function DropdownMenu({ position, onEdit, onDuplicate, onExport, onDelete, onClose }, ref) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleAction = (action: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    action();
    onClose();
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmingDelete) {
      onDelete();
      onClose();
    } else {
      setConfirmingDelete(true);
      setTimeout(() => setConfirmingDelete(false), 3000);
    }
  };

  return (
    <div
      ref={ref}
      className="fixed z-[999] w-40 rounded-lg border border-border bg-card shadow-xl py-1 animate-fade-in"
      style={{ top: position.top, left: position.left - 160 }}
    >
      <button onClick={handleAction(onEdit)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors text-left">
        <Pencil className="w-3.5 h-3.5" /> Edit
      </button>
      <button onClick={handleAction(onDuplicate)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors text-left">
        <CopyPlus className="w-3.5 h-3.5" /> Duplicate
      </button>
      <button onClick={handleAction(onExport)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors text-left">
        <Download className="w-3.5 h-3.5" /> Export to Clipboard
      </button>
      <div className="border-t border-border/50 my-1" />
      <button
        onClick={handleDeleteClick}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors text-left ${
          confirmingDelete
            ? 'bg-destructive/20 text-destructive font-medium'
            : 'hover:bg-destructive/10 text-destructive'
        }`}
      >
        <Trash2 className="w-3.5 h-3.5" /> {confirmingDelete ? 'Confirm Delete?' : 'Delete'}
      </button>
    </div>
  );
});
