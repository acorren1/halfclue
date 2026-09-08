"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Player = {
  id: string;
  room_id: string;
  name: string;
  player_number: number;
  is_host: boolean;
  joined_at: string;
};

type Room = {
  id: string;
  code: string;
  status: string;
  game_id: string | null;
};

export default function Home() {
  const [mode, setMode] = useState<"home" | "host" | "join" | "lobby">("home");

  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");

  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    return Array.from({ length: 4 }, () =>
      chars.charAt(Math.floor(Math.random() * chars.length))
    ).join("");
  }

  async function loadPlayers(roomId: string) {
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", roomId)
      .order("player_number");

    if (error) {
      console.error(error);
      return;
    }

    setPlayers(data ?? []);
  }

  useEffect(() => {
    if (!room?.id) return;

    loadPlayers(room.id);

    const channel = supabase
      .channel(`room-${room.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "players",
          filter: `room_id=eq.${room.id}`,
        },
        () => {
          loadPlayers(room.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [room?.id]);

  async function createGame() {
    if (!name.trim()) {
      setError("Enter your name first.");
      return;
    }

    setLoading(true);
    setError("");

    const code = generateRoomCode();

    const { data: newRoom, error: roomError } = await supabase
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

    const { data: hostPlayer, error: playerError } = await supabase
      .from("players")
      .insert({
        room_id: newRoom.id,
        name: name.trim(),
        player_number: 1,
        is_host: true,
      })
      .select()
      .single();

    if (playerError) {
      setError(playerError.message);
      setLoading(false);
      return;
    }

    setRoom(newRoom);
    setPlayers([hostPlayer]);
    setMode("lobby");
    setLoading(false);
  }

  async function joinGame() {
    if (!name.trim()) {
      setError("Enter your name first.");
      return;
    }

    if (joinCode.trim().length !== 4) {
      setError("Enter a 4-character room code.");
      return;
    }

    setLoading(true);
    setError("");

    const code = joinCode.trim().toUpperCase();

    const { data: foundRoom, error: roomError } = await supabase
      .from("rooms")
      .select("*")
      .eq("code", code)
      .eq("status", "waiting")
      .maybeSingle();

    if (roomError) {
      setError(roomError.message);
      setLoading(false);
      return;
    }

    if (!foundRoom) {
      setError("Room not found.");
      setLoading(false);
      return;
    }

    const { data: existingPlayers, error: playersError } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", foundRoom.id)
      .order("player_number");

    if (playersError) {
      setError(playersError.message);
      setLoading(false);
      return;
    }

    if ((existingPlayers?.length ?? 0) >= 2) {
      setError("This room is already full.");
      setLoading(false);
      return;
    }

    const { data: newPlayer, error: joinError } = await supabase
      .from("players")
      .insert({
        room_id: foundRoom.id,
        name: name.trim(),
        player_number: 2,
        is_host: false,
      })
      .select()
      .single();

    if (joinError) {
      setError(joinError.message);
      setLoading(false);
      return;
    }

    setRoom(foundRoom);
    setPlayers([...(existingPlayers ?? []), newPlayer]);
    setMode("lobby");
    setLoading(false);
  }

  function goHome() {
    setMode("home");
    setName("");
    setJoinCode("");
    setRoom(null);
    setPlayers([]);
    setError("");
  }

  if (mode === "lobby" && room) {
    const secondPlayerJoined = players.length >= 2;

    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-white p-6">
        <div className="w-full max-w-md text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">
            Room Code
          </p>

          <h1 className="text-7xl font-black tracking-widest my-5">
            {room.code}
          </h1>

          <div className="mt-10 space-y-3">
            {players.map((player) => (
              <div
                key={player.id}
                className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-900 px-5 py-4"
              >
                <span className="font-semibold">
                  {player.name}
                </span>

                <span className="text-sm text-zinc-500">
                  {player.is_host ? "HOST" : "PLAYER 2"}
                </span>
              </div>
            ))}

            {players.length < 2 && (
              <div className="rounded-2xl border border-dashed border-zinc-800 px-5 py-4 text-zinc-600">
                Waiting for Player 2...
              </div>
            )}
          </div>

          <div className="mt-10">
            {secondPlayerJoined ? (
              <>
                <p className="text-lg font-bold">
                  BOTH PLAYERS CONNECTED
                </p>

                <p className="text-zinc-500 mt-2">
                  Ready to play.
                </p>
              </>
            ) : (
              <>
                <p className="text-zinc-400">
                  Share the room code with another player.
                </p>

                <div className="mt-4 flex items-center justify-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                  <span className="text-sm text-zinc-500">
                    Waiting...
                  </span>
                </div>
              </>
            )}
          </div>

          <button
            onClick={goHome}
            className="mt-12 text-sm text-zinc-600"
          >
            Leave Room
          </button>
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

        {mode === "home" && (
          <div className="space-y-4">
            <button
              onClick={() => {
                setMode("host");
                setError("");
              }}
              className="w-full rounded-2xl bg-white text-black font-bold text-xl py-5"
            >
              HOST GAME
            </button>

            <button
              onClick={() => {
                setMode("join");
                setError("");
              }}
              className="w-full rounded-2xl border border-zinc-700 font-bold text-xl py-5"
            >
              JOIN GAME
            </button>
          </div>
        )}

        {mode === "host" && (
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
              onClick={goHome}
              className="w-full py-3 text-zinc-500"
            >
              Back
            </button>
          </div>
        )}

        {mode === "join" && (
          <div className="space-y-4">
            <label className="block text-sm text-zinc-400">
              Room code
            </label>

            <input
              value={joinCode}
              onChange={(e) =>
                setJoinCode(
                  e.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, "")
                    .slice(0, 4)
                )
              }
              placeholder="MRTQ"
              maxLength={4}
              className="w-full rounded-2xl bg-zinc-900 border border-zinc-700 px-5 py-4 text-center text-3xl font-bold tracking-[0.4em] uppercase outline-none"
            />

            <label className="block text-sm text-zinc-400 pt-2">
              Your name
            </label>

            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") joinGame();
              }}
              placeholder="Pete"
              maxLength={24}
              className="w-full rounded-2xl bg-zinc-900 border border-zinc-700 px-5 py-4 text-xl outline-none"
            />

            {error && (
              <p className="text-red-400 text-sm">
                {error}
              </p>
            )}

            <button
              onClick={joinGame}
              disabled={loading}
              className="w-full rounded-2xl bg-white text-black font-bold text-xl py-5 disabled:opacity-50"
            >
              {loading ? "JOINING..." : "JOIN ROOM"}
            </button>

            <button
              onClick={goHome}
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
