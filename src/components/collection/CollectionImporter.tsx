import { useState, useRef } from 'react';
import { parseCollectionList } from '@/services/collection/parseCollectionList';
import { getCardsByNames, getCardImageUrl } from '@/services/scryfall/client';
import { bulkImport, type BulkImportCard } from '@/services/collection/db';
import { Upload, FileUp, Loader2, Check, AlertCircle } from 'lucide-react';
import { trackEvent } from '@/services/analytics';

interface ImportResult {
  added: number;
  updated: number;
  updatedLabel?: string;
  notFound: string[];
}

interface CollectionImporterProps {
  /**
   * When provided, Scryfall-validated canonical card names are passed here
   * instead of importing to the collection DB.
   * Return { added, updated } counts for display in the result card.
   */
  onImportCards?: (validatedNames: string[]) => { added: number; updated: number };
  /** Label for the "updated" count (default: "cards updated") */
  updatedLabel?: string;
  /** Header label (default: "Import Collection") */
  label?: string;
}

export function CollectionImporter({ onImportCards, updatedLabel, label }: CollectionImporterProps = {}) {
  const [importText, setImportText] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImport = async (text: string) => {
    if (!text.trim()) return;

    setIsImporting(true);
    setResult(null);

    try {
      // Parse the input
      const parsed = parseCollectionList(text);
      if (parsed.length === 0) {
        setProgress('No cards found in input.');
        setIsImporting(false);
        return;
      }

      setProgress(`Parsed ${parsed.length} cards. Validating with Scryfall...`);

      // Batch validate names via Scryfall
      const names = parsed.map(c => c.name);
      const cardMap = await getCardsByNames(names, (fetched, total) => {
        setProgress(`Validating cards... ${fetched}/${total}`);
      });

      // Separate validated from not-found
      const notFound: string[] = [];
      const validatedNames: string[] = [];
      const validatedParsed: { name: string; quantity: number; card: typeof cardMap extends Map<string, infer V> ? V : never }[] = [];

      for (const { name, quantity } of parsed) {
        const scryfallCard = cardMap.get(name);
        if (scryfallCard) {
          validatedNames.push(scryfallCard.name);
          validatedParsed.push({ name: scryfallCard.name, quantity, card: scryfallCard });
        } else {
          notFound.push(name);
        }
      }

      if (onImportCards) {
        // Custom handler (e.g. adding to a list)
        const counts = onImportCards(validatedNames);
        setResult({ ...counts, updatedLabel, notFound });
      } else {
        // Default: import to collection DB
        if (validatedParsed.length > 0) {
          setProgress(`Saving ${validatedParsed.length} cards...`);
          const bulkCards: BulkImportCard[] = validatedParsed.map(({ name, quantity, card }) => ({
            name,
            quantity,
            typeLine: card.type_line,
            colorIdentity: card.color_identity,
            cmc: card.cmc,
            manaCost: card.mana_cost,
            rarity: card.rarity,
            imageUrl: getCardImageUrl(card, 'small'),
          }));
          const { added, updated } = await bulkImport(bulkCards);
          setResult({ added, updated, notFound });
          trackEvent('collection_imported', {
            cardCount: validatedParsed.length + notFound.length,
            added,
            updated,
          });
        } else {
          setResult({ added: 0, updated: 0, notFound });
        }
      }

      setImportText('');
    } catch (error) {
      console.error('Import failed:', error);
      setProgress('Import failed. Please try again.');
    } finally {
      setIsImporting(false);
      setProgress('');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        handleImport(text);
      }
    };
    reader.readAsText(file);

    // Reset input so same file can be uploaded again
    e.target.value = '';
  };

  const updatedText = result?.updatedLabel ?? 'cards updated';

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium">{label ?? 'Import Collection'}</label>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border hover:border-primary/50 hover:bg-accent transition-colors disabled:opacity-50"
          >
            <FileUp className="w-3.5 h-3.5" />
            Upload File
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.csv,.dec"
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>

        <p className="text-xs text-muted-foreground mb-2">
          Paste card names (one per line, CSV, or MTGA format). Quantities supported.
        </p>

        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          disabled={isImporting}
          placeholder={"1 Sol Ring\n4 Lightning Bolt\n1 Rhystic Study\n...\n\nAlso supports CSV and MTGA exports"}
          className="w-full h-36 px-3 py-2 text-sm bg-background border border-border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
        />

        <div className="flex justify-end gap-2 mt-2">
          {importText.trim() && (
            <button
              onClick={() => setImportText('')}
              disabled={isImporting}
              className="px-3 py-1.5 text-xs rounded-md hover:bg-accent transition-colors"
            >
              Clear
            </button>
          )}
          <button
            onClick={() => handleImport(importText)}
            disabled={isImporting || !importText.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isImporting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5" />
                Import Cards
              </>
            )}
          </button>
        </div>
      </div>

      {/* Progress */}
      {progress && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {progress}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="p-3 rounded-lg border border-border/50 bg-accent/30 space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Check className="w-4 h-4 text-green-500" />
            Import Complete
          </div>
          <p className="text-xs text-muted-foreground">
            {result.added > 0 && `${result.added} cards added`}
            {result.added > 0 && result.updated > 0 && ', '}
            {result.updated > 0 && `${result.updated} ${updatedText}`}
            {result.added === 0 && result.updated === 0 && 'No new cards added'}
          </p>
          {result.notFound.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center gap-1 text-xs text-amber-500">
                <AlertCircle className="w-3.5 h-3.5" />
                {result.notFound.length} card{result.notFound.length > 1 ? 's' : ''} not found:
              </div>
              <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
                {result.notFound.slice(0, 10).map(name => (
                  <li key={name} className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-muted-foreground shrink-0" />
                    {name}
                  </li>
                ))}
                {result.notFound.length > 10 && (
                  <li className="text-muted-foreground/70">and {result.notFound.length - 10} more</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
