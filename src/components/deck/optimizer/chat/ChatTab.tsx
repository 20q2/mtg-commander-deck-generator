import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Bot, User, Sparkles } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import type { DeckAnalysis } from '@/services/deckBuilder/deckAnalyzer';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// Answer engine — derives responses from deck analysis, no API key needed
// ---------------------------------------------------------------------------

interface AnalysisContext {
  analysis: DeckAnalysis;
  currentCards: ScryfallCard[];
  commanderName?: string;
  synergyMap?: Record<string, number>;
  bracketLevel?: number;
  deckPrice?: number;
}

function avg(vals: number[]): number {
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function roleSummary(ctx: AnalysisContext, roleKey: string, label: string): string {
  const deficit = ctx.analysis.roleDeficits.find(d => d.role === roleKey);
  if (!deficit) return `I don't have enough data on your ${label.toLowerCase()} pieces.`;
  const { current, target, deficit: def } = deficit;
  if (def > 0) {
    return `Your deck has **${current}** ${label.toLowerCase()} piece${current !== 1 ? 's' : ''}, but ideally wants **${target}**. That's a gap of **${def}**. Consider adding ${def} more.`;
  }
  if (current > target + 3) {
    return `You have **${current}** ${label.toLowerCase()} pieces vs a target of **${target}** — that's quite a few! You might be able to cut 1-2 and free up slots for other roles.`;
  }
  return `Your ${label.toLowerCase()} count looks solid: **${current}** (target: **${target}**). ✓`;
}

function topMisfits(ctx: AnalysisContext, count = 3): string {
  const misfits = ctx.analysis.misfits ?? [];
  if (!misfits.length) return `No obvious cut candidates — your deck is looking clean!`;
  const top = misfits.slice(0, count);
  const lines = top.map(m => {
    const reason = m.reasons[0]?.label ?? 'low synergy';
    return `• **${m.card.name}** — ${reason}`;
  });
  return `Top cut candidates based on your strategy:\n${lines.join('\n')}`;
}

function topRecs(ctx: AnalysisContext, count = 4): string {
  const recs = ctx.analysis.recommendations.filter(r => {
    const inDeck = ctx.currentCards.some(c => c.name === r.name);
    return !inDeck && (r.inclusion ?? 0) > 0;
  }).slice(0, count);
  if (!recs.length) return `No clear recommendations right now — your deck might already have the key pieces for its strategy.`;
  const lines = recs.map(r => `• **${r.name}** (in ${Math.round(r.inclusion ?? 0)}% of similar decks)`);
  return `Cards that could strengthen your deck:\n${lines.join('\n')}`;
}

function generateAnswer(q: string, ctx: AnalysisContext): string {
  const lq = q.toLowerCase();

  // Greetings / help
  if (/^(hi|hello|hey|oi|olá|ola|sup|what can you do|help)\b/.test(lq)) {
    return `Hey! I can answer questions about your deck. Try asking:\n• "How is my ramp?"\n• "What should I cut?"\n• "What's my bracket?"\n• "Tell me about my mana base"\n• "What cards should I add?"\n• "How is my card draw?"\n• "What's my curve like?"`;
  }

  // Ramp
  if (/ramp|mana rock|mana dork|acceleration|mana gen/.test(lq)) {
    return roleSummary(ctx, 'ramp', 'Ramp');
  }

  // Removal / interaction
  if (/remov|interaction|spot remov|counter|bounce|deal with/.test(lq)) {
    return roleSummary(ctx, 'removal', 'Removal');
  }

  // Board wipes
  if (/wipe|boardwipe|sweep|mass remov|reset the board|clear/.test(lq)) {
    return roleSummary(ctx, 'boardwipe', 'Board Wipe');
  }

  // Card draw
  if (/draw|card advantage|card draw|cycle|wheel|loot/.test(lq)) {
    return roleSummary(ctx, 'cardDraw', 'Card Draw');
  }

  // Protection
  if (/protect|hexproof|shroud|indestructible|ward/.test(lq)) {
    return roleSummary(ctx, 'protection', 'Protection');
  }

  // Cuts / misfits
  if (/cut|remove|worst|weakest|misfit|underperform|swap out|should i cut/.test(lq)) {
    return topMisfits(ctx);
  }

  // Recommendations / additions
  if (/add|suggest|recommend|upgrade|should i include|what to add|missing/.test(lq)) {
    return topRecs(ctx);
  }

  // Bracket / power level
  if (/bracket|power level|cedh|competitive|casual/.test(lq)) {
    const b = ctx.bracketLevel;
    if (!b) return `Bracket data isn't loaded yet — check the Bracket tab for details.`;
    const labels: Record<number, string> = { 1: 'Exhibition (very casual)', 2: 'Core (precon-level)', 3: 'Upgraded (focused)', 4: 'Optimized (high power)', 5: 'cEDH (competitive)' };
    return `Your deck is currently rated **Bracket ${b}** — ${labels[b] ?? 'unknown'}. This measures overall power level based on card choices, combos, and tutors.`;
  }

  // Mana base / lands
  if (/mana base|land|fixing|color fix|mana fix|tapland|basic/.test(lq)) {
    const { fixingGrade, fixingGradeMessage } = ctx.analysis.colorFixing;
    const { landCards } = ctx.analysis;
    const { grade: msGrade, message: msMsg } = ctx.analysis.manaSources;
    return `**Mana base:** ${landCards.length} lands, ramp grade **${msGrade}** — ${msMsg}\n\n**Color fixing:** Grade **${fixingGrade}** — ${fixingGradeMessage}`;
  }

  // Curve / tempo / speed
  if (/curve|tempo|speed|pacing|aggress|early game|late game|midrange/.test(lq)) {
    const { pacingLabel, curveGrade } = ctx.analysis;
    const avgCmc = avg(ctx.currentCards.filter(c => !c.type_line?.toLowerCase().includes('land')).map(c => c.cmc ?? 0));
    return `Your deck plays at a **${pacingLabel}** pace (curve grade: **${curveGrade.letter}**). Average CMC is **${avgCmc.toFixed(2)}** (excluding lands).\n\n${curveGrade.message}`;
  }

  // Synergy
  if (/synergy|combo|theme|how synergist|how connected/.test(lq)) {
    const sm = ctx.synergyMap ?? {};
    const vals = Object.values(sm);
    if (!vals.length) return `Synergy data isn't available yet — try re-running the analysis.`;
    const avgSyn = avg(vals);
    const top3 = Object.entries(sm).sort(([, a], [, b]) => b - a).slice(0, 3);
    const lines = top3.map(([name, score]) => `• **${name}** — ${(score * 100).toFixed(0)}%`);
    return `Average synergy score: **${(avgSyn * 100).toFixed(0)}%**\n\nHighest synergy cards:\n${lines.join('\n')}`;
  }

  // Budget / price
  if (/budget|price|cost|expensive|cheap|dollar|\$/.test(lq)) {
    if (ctx.deckPrice && ctx.deckPrice > 0) {
      return `Your deck is valued at approximately **$${ctx.deckPrice.toFixed(0)}**. Check the Cost tab for a full breakdown by card.`;
    }
    return `Deck price data isn't loaded yet — open the Cost tab to pull pricing from TCGPlayer.`;
  }

  // Health / overall summary
  if (/health|overall|summary|how.*deck|tell me about|how.*doing|score/.test(lq)) {
    const { rolesGrade, manaGrade, curveGrade, pacingLabel } = ctx.analysis;
    const deficits = ctx.analysis.roleDeficits.filter(d => d.deficit > 0).map(d => d.role);
    const misfitCount = (ctx.analysis.misfits ?? []).length;
    return `**${ctx.commanderName ?? 'Your deck'} at a glance:**\n• Roles: **${rolesGrade.letter}** — ${rolesGrade.message}\n• Mana: **${manaGrade.letter}** — ${manaGrade.message}\n• Curve: **${curveGrade.letter}** — ${curveGrade.message}\n• Pace: **${pacingLabel}**\n• Role gaps: ${deficits.length ? deficits.join(', ') : 'none ✓'}\n• Cut candidates: **${misfitCount}**`;
  }

  // Commander
  if (/commander|who.*command|general/.test(lq)) {
    const name = ctx.commanderName ?? 'your commander';
    return `Your commander is **${name}**. The deck is tuned to their strategy with a ${ctx.analysis.pacingLabel} pace.`;
  }

  // Fallback
  return `I'm not sure how to answer that exactly, but I can help with:\n• Role analysis (ramp, removal, card draw, board wipes, protection)\n• Cut suggestions & card recommendations\n• Mana base & color fixing\n• Curve & tempo\n• Bracket / power level\n• Overall deck health\n\nTry rephrasing your question!`;
}

// ---------------------------------------------------------------------------
// Suggested questions
// ---------------------------------------------------------------------------

const QUICK_QUESTIONS = [
  'Overall deck summary',
  'How is my ramp?',
  'What should I cut?',
  'What cards should I add?',
  'How is my mana base?',
  "What's my bracket?",
  'How is my card draw?',
  "What's my curve like?",
];

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

interface Message {
  id: number;
  role: 'user' | 'assistant';
  text: string;
}

function formatText(text: string) {
  // Bold **text** and line breaks
  const parts = text.split(/(\*\*[^*]+\*\*|\n)/g);
  return parts.map((part, i) => {
    if (part === '\n') return <br key={i} />;
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ChatTabProps {
  currentCards: ScryfallCard[];
  analysis: DeckAnalysis;
  commanderName?: string;
  synergyMap?: Record<string, number>;
  bracketLevel?: number;
  deckPrice?: number;
}

let _msgId = 0;

export function ChatTab({ currentCards, analysis, commanderName, synergyMap, bracketLevel, deckPrice }: ChatTabProps) {
  const [messages, setMessages] = useState<Message[]>(() => [{
    id: _msgId++,
    role: 'assistant',
    text: `Hi! Ask me anything about **${commanderName ?? 'your deck'}**. I can analyse your roles, mana base, curve, cuts, recommendations and more.`,
  }]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const ctx: AnalysisContext = { analysis, currentCards, commanderName, synergyMap, bracketLevel, deckPrice };

  const send = useCallback((text: string) => {
    const q = text.trim();
    if (!q) return;
    const userMsg: Message = { id: _msgId++, role: 'user', text: q };
    const answer = generateAnswer(q, ctx);
    const botMsg: Message = { id: _msgId++, role: 'assistant', text: answer };
    setMessages(prev => [...prev, userMsg, botMsg]);
    setInput('');
    inputRef.current?.focus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  }, [input, send]);

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-3 space-y-3 pr-1">
        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            {/* Avatar */}
            <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
              msg.role === 'assistant'
                ? 'bg-violet-500/20 border border-violet-500/30'
                : 'bg-muted border border-border/40'
            }`}>
              {msg.role === 'assistant'
                ? <Sparkles className="w-3.5 h-3.5 text-violet-300" />
                : <User className="w-3.5 h-3.5 text-foreground/60" />}
            </div>

            {/* Bubble */}
            <div className={`max-w-[82%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
              msg.role === 'user'
                ? 'bg-violet-600/20 border border-violet-500/30 text-foreground rounded-tr-sm'
                : 'bg-card/70 border border-border/30 text-foreground/90 rounded-tl-sm'
            }`}>
              {formatText(msg.text)}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Quick question chips */}
      <div className="py-2 border-t border-border/30">
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {QUICK_QUESTIONS.map(q => (
            <button
              key={q}
              type="button"
              onClick={() => send(q)}
              className="shrink-0 px-2.5 py-1 rounded-full border border-border/40 bg-muted/30 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60 hover:border-border/60 transition-colors whitespace-nowrap"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2 pt-2 border-t border-border/30">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask about your deck…"
          className="flex-1 px-3 py-2 text-sm bg-card/60 border border-border/60 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/60 placeholder:text-muted-foreground/50"
          autoComplete="off"
        />
        <Button type="submit" size="icon" disabled={!input.trim()} className="shrink-0 h-9 w-9">
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}
