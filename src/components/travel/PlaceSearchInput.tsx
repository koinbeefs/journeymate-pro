import { useMemo, useState, useEffect } from "react";
import { Search, MapPin, Loader2, Frown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { placesApi } from "@/lib/api";
import type { Location } from "@/types/travel";

interface Props {
  placeholder?: string;
  onPick: (place: Location) => void;
  exclude?: string[];
  className?: string;
}

export function PlaceSearchInput({ placeholder = "Search places…", onPick, exclude = [], className = "" }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState("");

  const { data: searchResults = [], refetch, isFetching } = useQuery({
    queryKey: ['placesSearch', q],
    queryFn: async () => {
      if (!q.trim()) return [];
      const res = await placesApi.autocomplete({ query: q.trim(), lat: 14.5995, lng: 120.9842 });
      setSearchedQuery(q.trim());
      return (res.data || []).map((item: any) => ({
        id: item.id || item.place_id || Math.random().toString(),
        name: item.name || item.description || "Unknown Place",
        description: item.address || item.formatted_address || "",
        lat: Number(item.lat) || 14.5995,
        lng: Number(item.lng) || 120.9842,
        type: item.type || "place",
      })) as Location[];
    },
    enabled: false,
  });

  const results = useMemo(() => {
    return searchResults
      .filter(l => !exclude.includes(l.id))
      .slice(0, 8);
  }, [searchResults, exclude]);

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (q.trim()) {
      refetch().then(() => setOpen(true));
    }
  };

  return (
    <div className={`relative ${className}`}>
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={e => { 
              setQ(e.target.value); 
              if (!e.target.value.trim()) setOpen(false);
            }}
            onFocus={() => { if (results.length > 0 && q.trim() === searchedQuery) setOpen(true); }}
            onBlur={() => setTimeout(() => setOpen(false), 250)}
            placeholder={placeholder}
            className="pl-9 pr-8 h-10 rounded-xl border-border bg-muted/50 text-xs"
          />
          {isFetching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary animate-spin" />
          )}
        </div>
        <Button type="submit" className="h-10 rounded-xl shadow-travel px-4 text-xs font-semibold shrink-0" disabled={isFetching || !q.trim()}>
          Search
        </Button>
      </form>

      {open && (
        <div className="absolute top-12 left-0 right-0 z-50 rounded-2xl bg-card border border-border shadow-card-hover overflow-hidden max-h-64 overflow-y-auto">
          {isFetching ? (
            <div className="p-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              Searching locations…
            </div>
          ) : results.length > 0 ? (
            results.map(r => (
              <button
                key={r.id}
                onMouseDown={() => { 
                  onPick(r); 
                  setQ(""); 
                  setOpen(false); 
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted transition-colors border-b border-border/40 last:border-0"
              >
                <MapPin className="w-4 h-4 text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{r.name}</p>
                  {r.description && <p className="text-[10px] text-muted-foreground truncate">{r.description}</p>}
                </div>
                <span className="text-[9px] text-muted-foreground capitalize bg-muted px-1.5 py-0.5 rounded">{r.type}</span>
              </button>
            ))
          ) : searchedQuery ? (
            <div className="p-4 text-center">
              <Frown className="w-5 h-5 mx-auto text-muted-foreground mb-1" />
              <p className="text-xs font-semibold text-foreground">No places found</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Could not find "{searchedQuery}". Try adding town or province name.</p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
