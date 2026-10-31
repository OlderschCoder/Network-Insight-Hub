import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Quote as QuoteIcon } from "lucide-react";

type Quote = { id: number; text: string; author: string | null; category: string | null };

export function QuoteOfDay() {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    fetch(`${import.meta.env.BASE_URL}api/quotes/today`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setQuote(d))
      .catch(() => setQuote(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !quote) return null;

  return (
    <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
      <CardContent className="py-4 px-5 flex items-start gap-3">
        <QuoteIcon className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm italic leading-relaxed">"{quote.text}"</p>
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-muted-foreground">
              — {quote.author ?? "Unknown"}
            </p>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
              Quote of the Day
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
