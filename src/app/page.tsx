"use client";

import { useState, useRef } from "react";

interface Lead {
  podcast_name: string;
  host: string;
  contact_email: string;
  website: string;
  podcast_link: string;
  category: string;
  notes: string;
}

export default function Home() {
  const [niche, setNiche] = useState("");
  const [leadCount, setLeadCount] = useState(25);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [streamText, setStreamText] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!niche.trim()) return;

    setLoading(true);
    setError("");
    setLeads([]);
    setStreamText("");

    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche: niche.trim(), count: leadCount }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Search failed");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "status") {
                setStreamText(parsed.message);
              } else if (parsed.type === "leads") {
                setLeads(parsed.leads);
              } else if (parsed.type === "text") {
                fullText += parsed.content;
                setStreamText(fullText.slice(-200));
              } else if (parsed.type === "error") {
                setError(parsed.message);
              }
            } catch {
              // skip malformed chunks
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(err.message);
      }
    } finally {
      setLoading(false);
      setStreamText("");
    }
  }

  function downloadCSV() {
    if (leads.length === 0) return;

    const headers = [
      "No.",
      "Podcast Name",
      "Host",
      "Contact Email",
      "Website",
      "Podcast Link",
      "Category",
      "Notes",
    ];

    const escape = (val: string) => {
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const rows = leads.map((lead, i) =>
      [
        String(i + 1),
        lead.podcast_name,
        lead.host,
        lead.contact_email,
        lead.website,
        lead.podcast_link,
        lead.category,
        lead.notes,
      ]
        .map(escape)
        .join(",")
    );

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `podcast_leads_${niche.replace(/\s+/g, "_").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="max-w-7xl mx-auto px-4 py-12">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-3">
          Podcast Lead Finder
        </h1>
        <p className="text-gray-400 text-lg">
          Enter a coach&apos;s niche and get podcast guest opportunities with real contact emails
        </p>
      </div>

      <form onSubmit={handleSearch} className="max-w-2xl mx-auto mb-12">
        <div className="flex flex-col gap-4">
          <input
            type="text"
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            placeholder="e.g. Manufacturing leadership, family business succession planning"
            className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={loading}
          />
          <div className="flex gap-4 items-center">
            <label className="text-sm text-gray-400 whitespace-nowrap">
              Number of leads:
            </label>
            <select
              value={leadCount}
              onChange={(e) => setLeadCount(Number(e.target.value))}
              className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <button
              type="submit"
              disabled={loading || !niche.trim()}
              className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium rounded-lg transition-colors"
            >
              {loading ? "Searching..." : "Find Leads"}
            </button>
          </div>
        </div>
      </form>

      {loading && streamText && (
        <div className="max-w-2xl mx-auto mb-8 p-4 bg-gray-900 border border-gray-800 rounded-lg">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-2 w-2 bg-blue-500 rounded-full animate-pulse" />
            <span className="text-sm text-gray-400">Searching for podcasts...</span>
          </div>
          <p className="text-sm text-gray-500 font-mono truncate">{streamText}</p>
        </div>
      )}

      {error && (
        <div className="max-w-2xl mx-auto mb-8 p-4 bg-red-950 border border-red-800 rounded-lg text-red-300">
          {error}
        </div>
      )}

      {leads.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">
              {leads.length} Lead{leads.length !== 1 ? "s" : ""} Found
            </h2>
            <button
              onClick={downloadCSV}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Download CSV
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-900 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Podcast</th>
                  <th className="px-4 py-3 font-medium">Host</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                  <th className="px-4 py-3 font-medium">Links</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead, i) => (
                  <tr
                    key={i}
                    className="border-t border-gray-800 hover:bg-gray-900/50"
                  >
                    <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                    <td className="px-4 py-3 font-medium">{lead.podcast_name}</td>
                    <td className="px-4 py-3 text-gray-300">{lead.host}</td>
                    <td className="px-4 py-3">
                      <a
                        href={`mailto:${lead.contact_email}`}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        {lead.contact_email}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 bg-gray-800 rounded text-xs text-gray-300">
                        {lead.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 max-w-xs truncate">
                      {lead.notes}
                    </td>
                    <td className="px-4 py-3 space-x-2">
                      {lead.website && (
                        <a
                          href={lead.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 text-xs"
                        >
                          Web
                        </a>
                      )}
                      {lead.podcast_link && (
                        <a
                          href={lead.podcast_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-green-400 hover:text-green-300 text-xs"
                        >
                          Listen
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
