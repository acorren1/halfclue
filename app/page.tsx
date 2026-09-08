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
  started_at: string | null;
};

export default function Home() {
  const [mode, setMode] = useState<"home" | "host" | "join" | "lobby">("home");

  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");

  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [myPlayerNumber, setMyPlayerNumber] = useState<number | null>(null);

  const [answer, setAnswer] = useState("");
  const [gameMessage, setGameMessage] = useState("");

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

    if (!error) {
      setPlayers(data ?? []);
    }
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
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${room.id}`,
        },
        (payload) => {
          setRoom(payload.new as Room);
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
    setMyPlayerNumber(1);
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
    setMyPlayerNumber(2);
    setMode("lobby");
    setLoading(false);
  }

  async function startGame() {
    if (!room) return;

    const { data, error } = await supabase
      .from("rooms")
      .update({
        status: "playing",
        game_id: "vault_001",
        started_at: new Date().toISOString(),
      })
      .eq("id", room.id)
      .select()
      .single();

    if (error) {
      setGameMessage(error.message);
      return;
    }

    setRoom(data);
  }

  async function submitAnswer() {
    if (!room) return;

    if (answer === "8634") {
      const { data, error } = await supabase
        .from("rooms")
        .update({
          status: "won",
        })
        .eq("id", room.id)
        .select()
        .single();

      if (error) {
        setGameMessage(error.message);
        return;
      }

      setRoom(data);
    } else {
      setGameMessage("Wrong code. Try again.");
      setAnswer("");
    }
  }

  function goHome() {
    setMode("home");
    setName("");
    setJoinCode("");
    setRoom(null);
    setPlayers([]);
    setMyPlayerNumber(null);
    setAnswer("");
    setGameMessage("");
    setError("");
  }

  if (room?.status === "won") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-white p-6">
        <div className="text-center">
          <p className="text-sm tracking-[0.3em] text-zinc-500 uppercase">
            The Vault
          </p>

          <h1 className="text-6xl font-black mt-6">
            VAULT OPEN
          </h1>

          <p className="text-zinc-400 mt-4">
            You put the clues together.
          </p>

          <div className="text-7xl mt-8">
            🔓
          </div>

          <button
            onClick={goHome}
            className="mt-12 rounded-2xl bg-white text-black font-bold px-8 py-4"
          >
            BACK TO HOME
          </button>
        </div>
      </main>
    );
  }

  if (room?.status === "playing") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-white p-6">
        <div className="w-full max-w-md">

          <div className="text-center mb-10">
            <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">
              Mission 01
            </p>

            <h1 className="text-4xl font-black mt-3">
              THE VAULT
            </h1>

            <p className="text-zinc-400 mt-3">
              Find the 4-digit combination.
            </p>
          </div>

          <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
            <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
              Your Half
            </p>

            {myPlayerNumber === 1 ? (
              <div className="mt-6 space-y-5">
                <div>
                  <p className="text-zinc-500 text-sm">
                    CODE ORDER
                  </p>

                  <p className="text-2xl font-bold mt-1">
                    ☀️ → 🔑 → 🌊 → 🌙
                  </p>
                </div>

                <div className="border-t border-zinc-800 pt-5">
                  <p>
                    ☀️ SUN = <strong>8</strong>
                  </p>
                </div>

                <div>
                  <p>
                    🌊 WAVE is <strong>3 less than KEY</strong>.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-6 space-y-5">
                <p>
                  🔑 KEY = <strong>6</strong>
                </p>

                <p>
                  🌙 MOON is <strong>half of SUN</strong>.
                </p>

                <p>
                  No digit appears twice.
                </p>
              </div>
            )}
          </div>

          <p className="text-center text-zinc-500 text-sm mt-5">
            Do not show your screen. Talk to your partner.
          </p>

          <div className="mt-10">
            <label className="text-sm text-zinc-400">
              Vault code
            </label>

            <input
              value={answer}
              onChange={(e) =>
                setAnswer(
                  e.target.value.replace(/\D/g, "").slice(0, 4)
                )
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") submitAnswer();
              }}
              inputMode="numeric"
              placeholder="••••"
              className="mt-2 w-full rounded-2xl bg-zinc-900 border border-zinc-700 px-5 py-4 text-center text-4xl font-bold tracking-[0.5em] outline-none"
            />

            {gameMessage && (
              <p className="text-center text-red-400 mt-3 text-sm">
                {gameMessage}
              </p>
            )}

            <button
              onClick={submitAnswer}
              disabled={answer.length !== 4}
              className="mt-4 w-full rounded-2xl bg-white text-black font-bold text-xl py-5 disabled:opacity-30"
            >
              UNLOCK VAULT
            </button>
          </div>
        </div>
      </main>
    );
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

          {secondPlayerJoined ? (
            <>
              <p className="mt-8 font-bold">
                BOTH PLAYERS CONNECTED
              </p>

              {myPlayerNumber === 1 ? (
                <button
                  onClick={startGame}
                  className="mt-6 w-full rounded-2xl bg-white text-black font-bold text-xl py-5"
                >
                  START THE VAULT
                </button>
              ) : (
                <p className="mt-5 text-zinc-500">
                  Waiting for the host to start...
                </p>
              )}
            </>
          ) : (
            <p className="mt-8 text-zinc-500">
              Waiting for another player...
            </p>
          )}

          <button
            onClick={goHome}
            className="mt-10 text-sm text-zinc-600"
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
              placeholder="Anthony"
              maxLength={24}
              className="w-full rounded-2xl bg-zinc-900 border border-zinc-700 px-5 py-4 text-xl outline-none"
            />

            {error && (
              <p className="text-red-400 text-sm">{error}</p>
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
              placeholder="9GWD"
              maxLength={4}
              className="w-full rounded-2xl bg-zinc-900 border border-zinc-700 px-5 py-4 text-center text-3xl font-bold tracking-[0.4em] outline-none"
            />

            <label className="block text-sm text-zinc-400 pt-2">
              Your name
            </label>

            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Peter"
              maxLength={24}
              className="w-full rounded-2xl bg-zinc-900 border border-zinc-700 px-5 py-4 text-xl outline-none"
            />

            {error && (
              <p className="text-red-400 text-sm">{error}</p>
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
