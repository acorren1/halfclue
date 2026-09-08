"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const [mode, setMode] = useState<"home" | "host">("home");
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    return Array.from({ length: 4 }, () =>
      chars.charAt(Math.floor(Math.random() * chars.length))
    ).join("");
  }

  async function createGame() {
    if (!name.trim()) {
      setError("Enter your name first.");
      return;
    }

    setLoading(true);
    setError("");

    const code = generateRoomCode();

    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .insert({
        code,
        status: "waiting",
      })
      .select()
      .single();

    if (roomError) {
      setError(roomError.message);
      setLoading(false);
      return;
    }

    const { error: playerError } = await supabase
      .from("players")
      .insert({
        room_id: room.id,
        name: name.trim(),
        player_number: 1,
        is_host: true,
      });

    if (playerError) {
      setError(playerError.message);
      setLoading(false);
      return;
    }

    setRoomCode(code);
    setLoading(false);
  }

  if (roomCode) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-white p-6">
        <div className="text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-zinc-400">
            Your room code
          </p>

          <h1 className="text-7xl font-black tracking-widest my-6">
            {roomCode}
          </h1>

          <p className="text-zinc-400">
            Waiting for another player...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-white p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-12">
          <h1 className="text-6xl font-black tracking-tight">
            HALFCLUE
          </h1>

          <p className="text-zinc-400 mt-3">
            You know half. They know half.
          </p>
        </div>

        {mode === "home" ? (
          <div className="space-y-4">
            <button
              onClick={() => setMode("host")}
              className="w-full rounded-2xl bg-white text-black font-bold text-xl py-5"
            >
              HOST GAME
            </button>

            <button
              disabled
              className="w-full rounded-2xl border border-zinc-700 text-zinc-500 font-bold text-xl py-5"
            >
              JOIN GAME
            </button>

            <p className="text-center text-xs text-zinc-600">
              Join Game coming next.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="block text-sm text-zinc-400">
              Your name
            </label>

            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createGame();
              }}
              placeholder="Anthony"
              maxLength={24}
              className="w-full rounded-2xl bg-zinc-900 border border-zinc-700 px-5 py-4 text-xl outline-none"
            />

            {error && (
              <p className="text-red-400 text-sm">
                {error}
              </p>
            )}

            <button
              onClick={createGame}
              disabled={loading}
              className="w-full rounded-2xl bg-white text-black font-bold text-xl py-5 disabled:opacity-50"
            >
              {loading ? "CREATING..." : "CREATE ROOM"}
            </button>

            <button
              onClick={() => setMode("home")}
              className="w-full py-3 text-zinc-500"
            >
              Back
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
