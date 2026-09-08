"use client";

import { useEffect, useMemo, useState } from "react";
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
  finished_at: string | null;
  current_round: number;
  penalty_seconds: number;
};

const GAME_SECONDS = 300;
const WRONG_PENALTY = 15;

function formatTime(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function Home() {
  const [mode, setMode] =
    useState<"home" | "host" | "join" | "lobby">("home");

  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");

  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [myPlayerNumber, setMyPlayerNumber] = useState<number | null>(null);

  const [answer, setAnswer] = useState("");
  const [sequence, setSequence] = useState("");
  const [gameMessage, setGameMessage] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [now, setNow] = useState(Date.now());

  function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    return Array.from({ length: 4 }, () =>
      chars.charAt(Math.floor(Math.random() * chars.length))
    ).join("");
  }

  async function loadPlayers(roomId: string) {
    const { data } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", roomId)
      .order("player_number");

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
        () => loadPlayers(room.id)
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

  useEffect(() => {
    if (room?.status !== "playing") return;

    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => window.clearInterval(interval);
  }, [room?.status]);

  useEffect(() => {
    setAnswer("");
    setSequence("");
    setGameMessage("");
  }, [room?.current_round]);

  const elapsedSeconds = useMemo(() => {
    if (!room?.started_at) return 0;

    const end =
      room.finished_at && room.status !== "playing"
        ? new Date(room.finished_at).getTime()
        : now;

    const raw = Math.floor(
      (end - new Date(room.started_at).getTime()) / 1000
    );

    return Math.max(0, raw + (room.penalty_seconds ?? 0));
  }, [
    room?.started_at,
    room?.finished_at,
    room?.status,
    room?.penalty_seconds,
    now,
  ]);

  const remainingSeconds = Math.max(
    0,
    GAME_SECONDS - elapsedSeconds
  );

  useEffect(() => {
    if (
      room?.status === "playing" &&
      room.started_at &&
      remainingSeconds <= 0
    ) {
      expireGame();
    }
  }, [remainingSeconds, room?.status]);

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
        current_round: 1,
        penalty_seconds: 0,
      })
      .select()
      .single();

    if (roomError) {
      setError(roomError.message);
      setLoading(false);
      return;
    }

    const { data: hostPlayer, error: playerError } =
      await supabase
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

    const { data: foundRoom, error: roomError } =
      await supabase
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

    const { data: existingPlayers } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", foundRoom.id)
      .order("player_number");

    if ((existingPlayers?.length ?? 0) >= 2) {
      setError("This room is already full.");
      setLoading(false);
      return;
    }

    const { data: newPlayer, error: joinError } =
      await supabase
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
        game_id: "vault_alpha",
        current_round: 1,
        penalty_seconds: 0,
        started_at: new Date().toISOString(),
        finished_at: null,
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

  async function addPenalty() {
    if (!room) return;

    const newPenalty =
      (room.penalty_seconds ?? 0) + WRONG_PENALTY;

    const { data } = await supabase
      .from("rooms")
      .update({
        penalty_seconds: newPenalty,
      })
      .eq("id", room.id)
      .select()
      .single();

    if (data) {
      setRoom(data);
    }

    setGameMessage(`Wrong. +${WRONG_PENALTY} seconds.`);
  }

  async function advanceRound() {
    if (!room) return;

    if (room.current_round >= 3) {
      const { data, error } = await supabase
        .from("rooms")
        .update({
          status: "won",
          finished_at: new Date().toISOString(),
        })
        .eq("id", room.id)
        .select()
        .single();

      if (error) {
        setGameMessage(error.message);
        return;
      }

      setRoom(data);
      return;
    }

    const { data, error } = await supabase
      .from("rooms")
      .update({
        current_round: room.current_round + 1,
      })
      .eq("id", room.id)
      .eq("current_round", room.current_round)
      .select()
      .single();

    if (error) {
      setGameMessage(error.message);
      return;
    }

    setRoom(data);
  }

  async function submitNumeric(correctAnswer: string) {
    if (answer === correctAnswer) {
      await advanceRound();
    } else {
      setAnswer("");
      await addPenalty();
    }
  }

  async function submitSequence() {
    if (sequence === "CADB") {
      await advanceRound();
    } else {
      setSequence("");
      await addPenalty();
    }
  }

  async function expireGame() {
    if (!room || room.status !== "playing") return;

    const { data } = await supabase
      .from("rooms")
      .update({
        status: "lost",
        finished_at: new Date().toISOString(),
      })
      .eq("id", room.id)
      .eq("status", "playing")
      .select()
      .maybeSingle();

    if (data) {
      setRoom(data);
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
    setSequence("");
    setGameMessage("");
    setError("");
  }

  function TimerBar() {
    const percentage =
      (remainingSeconds / GAME_SECONDS) * 100;

    return (
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
            Mission Time
          </span>

          <span className="text-xl font-bold tabular-nums">
            {formatTime(remainingSeconds)}
          </span>
        </div>

        <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full bg-white transition-all duration-300"
            style={{ width: `${percentage}%` }}
          />
        </div>

        {(room?.penalty_seconds ?? 0) > 0 && (
          <p className="text-right text-xs text-red-400 mt-2">
            +{room?.penalty_seconds}s penalties
          </p>
        )}
      </div>
    );
  }

  if (room?.status === "won") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-white p-6">
        <div className="w-full max-w-md text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">
            Mission Complete
          </p>

          <h1 className="text-6xl font-black mt-5">
            VAULT OPEN
          </h1>

          <div className="text-7xl mt-7">🔓</div>

          <div className="mt-10 rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
            <p className="text-zinc-500 text-sm uppercase tracking-[0.2em]">
              Final Time
            </p>

            <p className="text-5xl font-black mt-2">
              {formatTime(elapsedSeconds)}
            </p>

            <p className="text-zinc-500 mt-3">
              {room.penalty_seconds > 0
                ? `${room.penalty_seconds} seconds of penalties`
                : "No penalties"}
            </p>
          </div>

          <button
            onClick={goHome}
            className="mt-8 w-full rounded-2xl bg-white text-black font-bold py-5"
          >
            BACK TO HOME
          </button>
        </div>
      </main>
    );
  }

  if (room?.status === "lost") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-white p-6">
        <div className="w-full max-w-md text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">
            Mission Failed
          </p>

          <h1 className="text-6xl font-black mt-5">
            TIME'S UP
          </h1>

          <div className="text-7xl mt-7">🔒</div>

          <p className="text-zinc-400 mt-6">
            The vault sealed before you cracked it.
          </p>

          <button
            onClick={goHome}
            className="mt-10 w-full rounded-2xl bg-white text-black font-bold py-5"
          >
            TRY AGAIN
          </button>
        </div>
      </main>
    );
  }

  if (room?.status === "playing") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-white p-6">
        <div className="w-full max-w-md">

          <TimerBar />

          <div className="flex justify-center gap-2 mb-8">
            {[1, 2, 3].map((roundNumber) => (
              <div
                key={roundNumber}
                className={`h-2 flex-1 rounded-full ${
                  roundNumber <= room.current_round
                    ? "bg-white"
                    : "bg-zinc-800"
                }`}
              />
            ))}
          </div>

          {room.current_round === 1 && (
            <>
              <div className="text-center mb-8">
                <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">
                  Round 1 of 3
                </p>

                <h1 className="text-4xl font-black mt-3">
                  OUTER LOCK
                </h1>

                <p className="text-zinc-400 mt-3">
                  Neither of you has enough information alone.
                </p>
              </div>

              <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
                <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
                  Your Half
                </p>

                {myPlayerNumber === 1 ? (
                  <div className="mt-6 space-y-5">
                    <div>
                      <p className="text-sm text-zinc-500">
                        LOCK ORDER
                      </p>

                      <p className="text-3xl mt-2">
                        ▲ ● ◆ ■
                      </p>
                    </div>

                    <p>
                      ▲ TRIANGLE is{" "}
                      <strong>3 more than DIAMOND</strong>.
                    </p>

                    <p>
                      ● CIRCLE is{" "}
                      <strong>2 less than TRIANGLE</strong>.
                    </p>
                  </div>
                ) : (
                  <div className="mt-6 space-y-5">
                    <p>
                      ◆ DIAMOND = <strong>4</strong>
                    </p>

                    <p>
                      ■ SQUARE is{" "}
                      <strong>1 more than CIRCLE</strong>.
                    </p>

                    <p>
                      Every symbol represents one digit.
                    </p>
                  </div>
                )}
              </div>

              <NumericAnswer
                answer={answer}
                setAnswer={setAnswer}
                message={gameMessage}
                onSubmit={() => submitNumeric("7546")}
              />
            </>
          )}

          {room.current_round === 2 && (
            <>
              <div className="text-center mb-8">
                <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">
                  Round 2 of 3
                </p>

                <h1 className="text-4xl font-black mt-3">
                  SECURITY GRID
                </h1>

                <p className="text-zinc-400 mt-3">
                  One of you has the map. One has the key.
                </p>
              </div>

              <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
                <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
                  Your Half
                </p>

                {myPlayerNumber === 1 ? (
                  <div className="mt-6">
                    <p className="text-sm text-zinc-500 mb-4">
                      SECURITY GRID
                    </p>

                    <div className="grid grid-cols-3 gap-3 text-3xl text-center">
                      <div className="rounded-xl bg-zinc-800 p-4">🌙</div>
                      <div className="rounded-xl bg-zinc-800 p-4">🔑</div>
                      <div className="rounded-xl bg-zinc-800 p-4">⚡</div>

                      <div className="rounded-xl bg-zinc-800 p-4">👁️</div>
                      <div className="rounded-xl bg-zinc-800 p-4">☀️</div>
                      <div className="rounded-xl bg-zinc-800 p-4">💎</div>

                      <div className="rounded-xl bg-zinc-800 p-4">🔒</div>
                      <div className="rounded-xl bg-zinc-800 p-4">🌊</div>
                      <div className="rounded-xl bg-zinc-800 p-4">👑</div>
                    </div>

                    <div className="mt-6 space-y-3">
                      <p>
                        Start at the <strong>center</strong>.
                      </p>

                      <p>
                        Move: <strong>NORTH → EAST → SOUTH → SOUTHWEST</strong>
                      </p>

                      <p>
                        Read every symbol you land on.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 space-y-4">
                    <p className="text-zinc-500 text-sm">
                      SYMBOL VALUES
                    </p>

                    <p>🔑 KEY = <strong>8</strong></p>
                    <p>⚡ BOLT = <strong>2</strong></p>
                    <p>💎 DIAMOND = <strong>6</strong></p>
                    <p>☀️ SUN = <strong>4</strong></p>
                    <p>👑 CROWN = <strong>1</strong></p>
                    <p>🌊 WAVE = <strong>7</strong></p>
                  </div>
                )}
              </div>

              <NumericAnswer
                answer={answer}
                setAnswer={setAnswer}
                message={gameMessage}
                onSubmit={() => submitNumeric("8267")}
              />
            </>
          )}

          {room.current_round === 3 && (
            <>
              <div className="text-center mb-8">
                <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">
                  Round 3 of 3
                </p>

                <h1 className="text-4xl font-black mt-3">
                  FINAL CONTROL
                </h1>

                <p className="text-zinc-400 mt-3">
                  Operator and manual must work together.
                </p>
              </div>

              <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
                <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
                  Your Half
                </p>

                {myPlayerNumber === 1 ? (
                  <div className="mt-6">
                    <p className="text-zinc-400 mb-5">
                      You are the <strong>OPERATOR</strong>.
                    </p>

                    <p className="mb-6">
                      Your partner has the operating manual.
                      Press the controls in the correct order.
                    </p>

                    <div className="grid grid-cols-2 gap-3">
                      {["A", "B", "C", "D"].map((button) => (
                        <button
                          key={button}
                          onClick={() => {
                            if (sequence.length < 4) {
                              setSequence(sequence + button);
                            }
                          }}
                          className="rounded-2xl border border-zinc-700 bg-zinc-800 py-7 text-3xl font-black"
                        >
                          {button}
                        </button>
                      ))}
                    </div>

                    <p className="text-center text-2xl tracking-[0.4em] mt-6 min-h-8">
                      {sequence || "----"}
                    </p>

                    <button
                      onClick={() => setSequence("")}
                      className="w-full text-sm text-zinc-500 mt-3"
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <div className="mt-6 space-y-5">
                    <p className="text-zinc-400">
                      You have the <strong>CONTROL MANUAL</strong>.
                    </p>

                    <div className="border-t border-zinc-800 pt-5 space-y-4">
                      <p>
                        1. Begin with the control that comes{" "}
                        <strong>alphabetically after B</strong>.
                      </p>

                      <p>
                        2. Next press the control{" "}
                        <strong>two letters before C</strong>.
                      </p>

                      <p>
                        3. The third control is the{" "}
                        <strong>last letter alphabetically</strong>.
                      </p>

                      <p>
                        4. Finish with the only control{" "}
                        <strong>not yet used</strong>.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {myPlayerNumber === 1 ? (
                <div className="mt-8">
                  {gameMessage && (
                    <p className="text-center text-red-400 mb-3">
                      {gameMessage}
                    </p>
                  )}

                  <button
                    onClick={submitSequence}
                    disabled={sequence.length !== 4}
                    className="w-full rounded-2xl bg-white text-black font-bold text-xl py-5 disabled:opacity-30"
                  >
                    EXECUTE SEQUENCE
                  </button>
                </div>
              ) : (
                <p className="text-center text-zinc-500 mt-8">
                  Guide your operator. You cannot press the controls.
                </p>
              )}
            </>
          )}

        </div>
      </main>
    );
  }

  if (mode === "lobby" && room) {
    const ready = players.length >= 2;

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
                className="flex justify-between rounded-2xl border border-zinc-800 bg-zinc-900 px-5 py-4"
              >
                <span className="font-semibold">
                  {player.name}
                </span>

                <span className="text-sm text-zinc-500">
                  {player.is_host ? "HOST" : "PLAYER 2"}
                </span>
              </div>
            ))}

            {!ready && (
              <div className="rounded-2xl border border-dashed border-zinc-800 px-5 py-4 text-zinc-600">
                Waiting for Player 2...
              </div>
            )}
          </div>

          {ready ? (
            myPlayerNumber === 1 ? (
              <>
                <p className="mt-8 font-bold">
                  BOTH PLAYERS CONNECTED
                </p>

                <button
                  onClick={startGame}
                  className="mt-6 w-full rounded-2xl bg-white text-black font-bold text-xl py-5"
                >
                  START THE VAULT
                </button>
              </>
            ) : (
              <p className="mt-8 text-zinc-500">
                Waiting for the host to start...
              </p>
            )
          ) : (
            <p className="mt-8 text-zinc-500">
              Share the code with another player.
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
          <h1 className="text-6xl font-black">
            HALFCLUE
          </h1>

          <p className="text-zinc-400 mt-3">
            No one has the full answer.
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
          <NamePanel
            name={name}
            setName={setName}
            loading={loading}
            error={error}
            actionText="CREATE ROOM"
            loadingText="CREATING..."
            onAction={createGame}
            onBack={goHome}
          />
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
              placeholder="AB7K"
              maxLength={4}
              className="w-full rounded-2xl bg-zinc-900 border border-zinc-700 px-5 py-4 text-center text-3xl font-bold tracking-[0.4em] outline-none"
            />

            <NamePanel
              name={name}
              setName={setName}
              loading={loading}
              error={error}
              actionText="JOIN ROOM"
              loadingText="JOINING..."
              onAction={joinGame}
              onBack={goHome}
            />
          </div>
        )}

      </div>
    </main>
  );
}

function NumericAnswer({
  answer,
  setAnswer,
  message,
  onSubmit,
}: {
  answer: string;
  setAnswer: (value: string) => void;
  message: string;
  onSubmit: () => void;
}) {
  return (
    <div className="mt-8">
      <label className="text-sm text-zinc-400">
        Combination
      </label>

      <input
        value={answer}
        onChange={(e) =>
          setAnswer(
            e.target.value.replace(/\D/g, "").slice(0, 4)
          )
        }
        onKeyDown={(e) => {
          if (e.key === "Enter" && answer.length === 4) {
            onSubmit();
          }
        }}
        inputMode="numeric"
        placeholder="••••"
        className="mt-2 w-full rounded-2xl bg-zinc-900 border border-zinc-700 px-5 py-4 text-center text-4xl font-bold tracking-[0.5em] outline-none"
      />

      {message && (
        <p className="text-center text-red-400 mt-3 text-sm">
          {message}
        </p>
      )}

      <button
        onClick={onSubmit}
        disabled={answer.length !== 4}
        className="mt-4 w-full rounded-2xl bg-white text-black font-bold text-xl py-5 disabled:opacity-30"
      >
        SUBMIT CODE
      </button>
    </div>
  );
}

function NamePanel({
  name,
  setName,
  loading,
  error,
  actionText,
  loadingText,
  onAction,
  onBack,
}: {
  name: string;
  setName: (value: string) => void;
  loading: boolean;
  error: string;
  actionText: string;
  loadingText: string;
  onAction: () => void;
  onBack: () => void;
}) {
  return (
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
        <p className="text-red-400 text-sm">
          {error}
        </p>
      )}

      <button
        onClick={onAction}
        disabled={loading}
        className="w-full rounded-2xl bg-white text-black font-bold text-xl py-5 disabled:opacity-50"
      >
        {loading ? loadingText : actionText}
      </button>

      <button
        onClick={onBack}
        className="w-full py-3 text-zinc-500"
      >
        Back
      </button>
    </div>
  );
}
