"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

/**
 * Every validator as a column. Height is stake (square-root scale, so the
 * small ones stay visible). Colour is the viability test: does commission
 * income pay the operating cost today, and after the issuance cut?
 */

export type SkylineColumn = { stake: number; state: "viable" | "lost" | "below" | "unknown" };

const COLORS = { viable: "#2a2722", lost: "#b5391e", below: "#cfc6b2", unknown: "#e3dccd" } as const;
const COLS = 30;
const GAP = 0.34;

function Columns({ columns }: { columns: SkylineColumn[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const group = useRef<THREE.Group>(null);
  const max = useMemo(() => Math.max(...columns.map((c) => c.stake), 1), [columns]);
  const targets = useMemo(() => columns.map((c) => new THREE.Color(COLORS[c.state])), [columns]);
  const current = useRef<THREE.Color[]>([]);
  const rows = Math.ceil(columns.length / COLS);

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const dummy = new THREE.Object3D();
    columns.forEach((c, i) => {
      const h = 0.06 + 3.4 * Math.sqrt(c.stake / max);
      const x = ((i % COLS) - (COLS - 1) / 2) * GAP;
      const z = (Math.floor(i / COLS) - (rows - 1) / 2) * GAP;
      dummy.position.set(x, h / 2, z);
      dummy.scale.set(1, h, 1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    if (current.current.length !== columns.length) current.current = targets.map((t) => t.clone());
  }, [columns, max, rows, targets]);

  useFrame((state, dt) => {
    const m = mesh.current;
    if (!m) return;
    const k = 1 - Math.exp(-6 * Math.min(dt, 0.05));
    let changed = false;
    targets.forEach((t, i) => {
      const c = current.current[i];
      if (!c) return;
      if (!c.equals(t)) {
        c.lerp(t, k);
        changed = true;
      }
      m.setColorAt(i, c);
    });
    if (m.instanceColor && (changed || state.clock.elapsedTime < 1)) m.instanceColor.needsUpdate = true;
    if (group.current) group.current.rotation.y = -0.55 + Math.sin(state.clock.elapsedTime * 0.12) * 0.12 + state.pointer.x * 0.12;
  });

  return (
    <group ref={group} position={[0, -0.9, 0]}>
      <instancedMesh ref={mesh} args={[undefined, undefined, columns.length]}>
        <boxGeometry args={[0.22, 1, 0.22]} />
        <meshStandardMaterial roughness={0.62} metalness={0.05} />
      </instancedMesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]}>
        <planeGeometry args={[COLS * GAP + 1.2, rows * GAP + 1.2]} />
        <meshStandardMaterial color="#e6dfcf" roughness={1} />
      </mesh>
    </group>
  );
}

export default function SkylineScene({ columns, paused }: { columns: SkylineColumn[]; paused?: boolean }) {
  return (
    <Canvas dpr={[1, 2]} frameloop={paused ? "never" : "always"} camera={{ position: [0, 6.4, 15.5], fov: 30 }} gl={{ antialias: true, alpha: true }} style={{ background: "transparent" }} aria-hidden onCreated={({ camera }) => camera.lookAt(0, 0.1, 0)}>
      <ambientLight intensity={1.5} color="#fff6e8" />
      <directionalLight position={[6, 9, 4]} intensity={2.2} color="#fff0d8" />
      <directionalLight position={[-5, 4, -6]} intensity={0.7} color="#d9cfbd" />
      <Columns columns={columns} />
    </Canvas>
  );
}
