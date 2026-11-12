"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { mulberry32 } from "@/lib/model";

/**
 * A beam balance whose tilt is a measurement, not decoration. The left pan
 * carries the NEAR minted to pay for security; the right pan carries what
 * comes back to holders (buybacks and gas burn). Each coin is the same amount
 * of NEAR on both sides, so the picture is to scale.
 */

export type ScaleProps = {
  /** coins on the minted pan */
  left: number;
  /** coins bought back */
  rightBuyback: number;
  /** coins burned as gas (may be fractional; drawn as a thinner coin) */
  rightBurn: number;
  /** (buyback + burn) / minted */
  coverage: number;
  paused?: boolean;
};

const BEAM_HALF = 2.55;
const PIVOT_Y = 2.75;
const HANG = 1.55;
const MAX_TILT = 0.24;
const COIN_H = 0.085;
const COIN_R = 0.4;
const MAX_COINS = 20;

const brass = new THREE.MeshStandardMaterial({ color: "#b89443", metalness: 1, roughness: 0.3 });
const brassDark = new THREE.MeshStandardMaterial({ color: "#8a6c2c", metalness: 1, roughness: 0.42 });
const stone = new THREE.MeshStandardMaterial({ color: "#26231e", metalness: 0.1, roughness: 0.75 });
const mintedMat = new THREE.MeshStandardMaterial({ color: "#b5391e", metalness: 0.05, roughness: 0.5 });
const buybackMat = new THREE.MeshStandardMaterial({ color: "#d2ad52", metalness: 1, roughness: 0.2 });
const burnMat = new THREE.MeshStandardMaterial({ color: "#1b1915", metalness: 0.3, roughness: 0.6 });

function Coin({ index, visible, material, thickness = 1, seed }: { index: number; visible: boolean; material: THREE.Material; thickness?: number; seed: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const jitter = useMemo(() => {
    const r = mulberry32(seed * 977 + index * 131 + 7);
    return { x: (r() - 0.5) * 0.07, z: (r() - 0.5) * 0.07, rot: r() * Math.PI };
  }, [index, seed]);
  useFrame((_, dt) => {
    const m = ref.current;
    if (!m) return;
    const target = visible ? 1 : 0;
    // coins lower in the stack settle first
    const speed = visible ? 7 - Math.min(index, 12) * 0.25 : 9;
    const s = THREE.MathUtils.damp(m.scale.x, target, speed, Math.min(dt, 0.05));
    m.scale.setScalar(Math.max(s, 0.0001));
    m.visible = s > 0.002;
  });
  return (
    <mesh ref={ref} position={[jitter.x, 0.05 + COIN_H * (index + 0.5) * 1.06, jitter.z]} rotation={[0, jitter.rot, 0]} material={material} castShadow scale={0.0001}>
      <cylinderGeometry args={[COIN_R, COIN_R, COIN_H * thickness, 48]} />
    </mesh>
  );
}

function Pan({ children }: { children?: React.ReactNode }) {
  const rods = [0, 1, 2].map((i) => {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * 0.62;
    const z = Math.sin(a) * 0.62;
    const len = Math.hypot(x, HANG, z);
    const dir = new THREE.Vector3(-x, HANG, -z).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    return { pos: [x / 2, HANG / 2, z / 2] as [number, number, number], q, len };
  });
  return (
    <group position={[0, -HANG, 0]}>
      <mesh material={brass} castShadow receiveShadow>
        <cylinderGeometry args={[0.72, 0.6, 0.06, 64]} />
      </mesh>
      <mesh material={brassDark} position={[0, 0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.71, 0.022, 12, 64]} />
      </mesh>
      {rods.map((r, i) => (
        <mesh key={i} position={r.pos} quaternion={r.q} material={brassDark}>
          <cylinderGeometry args={[0.012, 0.012, r.len, 8]} />
        </mesh>
      ))}
      {children}
    </group>
  );
}

function Balance({ left, rightBuyback, rightBurn, coverage }: ScaleProps) {
  const beam = useRef<THREE.Group>(null);
  const panL = useRef<THREE.Group>(null);
  const panR = useRef<THREE.Group>(null);
  const rig = useRef<THREE.Group>(null);
  const tilt = useRef(0);
  const vel = useRef(0);
  const { pointer, viewport } = useThree();
  // fit the whole instrument, pans included, into whatever shape the panel has
  const fit = Math.min(1.3, viewport.width / 6.5, viewport.height / 5.0);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const target = THREE.MathUtils.clamp((1 - Math.min(coverage, 2)) * MAX_TILT, -MAX_TILT, MAX_TILT);
    // underdamped spring: the beam overshoots and settles like a real balance
    const k = 14;
    const c = 2.6;
    vel.current += (-k * (tilt.current - target) - c * vel.current) * dt;
    tilt.current += vel.current * dt;
    const t = tilt.current + Math.sin(state.clock.elapsedTime * 0.7) * 0.004;
    if (beam.current) beam.current.rotation.z = t;
    const dx = Math.cos(t) * BEAM_HALF;
    const dy = Math.sin(t) * BEAM_HALF;
    panL.current?.position.set(-dx, PIVOT_Y - dy, 0);
    panR.current?.position.set(dx, PIVOT_Y + dy, 0);
    if (rig.current) {
      rig.current.rotation.y = THREE.MathUtils.damp(rig.current.rotation.y, -0.32 + pointer.x * 0.22, 3, dt);
      rig.current.rotation.x = THREE.MathUtils.damp(rig.current.rotation.x, pointer.y * -0.05, 3, dt);
    }
  });

  const tips = [-BEAM_HALF, BEAM_HALF];
  const burnThickness = Math.max(0.18, Math.min(1, rightBurn));

  return (
    <group ref={rig} position={[0, -1.9 * fit, 0]} scale={fit}>
      {/* plinth and column */}
      <mesh material={stone} position={[0, 0.09, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[1.15, 1.25, 0.18, 96]} />
      </mesh>
      <mesh material={brassDark} position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.34, 0.42, 0.08, 64]} />
      </mesh>
      <mesh material={brass} position={[0, PIVOT_Y / 2 + 0.1, 0]} castShadow>
        <cylinderGeometry args={[0.055, 0.085, PIVOT_Y - 0.1, 32]} />
      </mesh>
      <mesh material={brass} position={[0, PIVOT_Y + 0.02, 0]} castShadow>
        <sphereGeometry args={[0.13, 32, 32]} />
      </mesh>
      {/* pointer needle fixed to the beam, and its reference mark on the column */}
      <mesh material={stone} position={[0, PIVOT_Y - 0.62, 0.07]}>
        <boxGeometry args={[0.012, 0.16, 0.01]} />
      </mesh>

      <group ref={beam} position={[0, PIVOT_Y, 0]}>
        <mesh material={brass} castShadow rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.038, 0.038, BEAM_HALF * 2, 24]} />
        </mesh>
        <mesh material={mintedMat} position={[0, -0.34, 0.06]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.03, 0.62, 12]} />
        </mesh>
        {tips.map((x) => (
          <mesh key={x} material={brassDark} position={[x, 0, 0]}>
            <sphereGeometry args={[0.07, 24, 24]} />
          </mesh>
        ))}
      </group>

      <group ref={panL}>
        <Pan>
          {Array.from({ length: MAX_COINS }, (_, i) => (
            <Coin key={i} index={i} seed={1} visible={i < left} material={mintedMat} />
          ))}
        </Pan>
      </group>
      <group ref={panR}>
        <Pan>
          {Array.from({ length: MAX_COINS }, (_, i) => (
            <Coin key={i} index={i} seed={2} visible={i < rightBuyback} material={buybackMat} />
          ))}
          <group position={[0, COIN_H * 1.06 * rightBuyback, 0]}>
            <Coin index={0} seed={3} visible={rightBurn > 0.02} material={burnMat} thickness={burnThickness} />
          </group>
        </Pan>
      </group>
      <ContactShadows position={[0, 0.001, 0]} opacity={0.38} scale={12} blur={2.6} far={5} color="#3a2f1c" />
    </group>
  );
}

export default function ScaleScene(props: ScaleProps) {
  return (
    <Canvas
      shadows={false}
      dpr={[1, 2]}
      frameloop={props.paused ? "never" : "always"}
      camera={{ position: [0, 0.35, 11], fov: 31 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ background: "transparent" }}
      aria-hidden
    >
      <ambientLight intensity={0.55} color="#fff4e0" />
      <directionalLight position={[4, 7, 5]} intensity={2.1} color="#fff1d6" />
      <directionalLight position={[-6, 3, -2]} intensity={0.5} color="#e8d9c0" />
      {/* A small studio built from light panels: brass needs something to reflect, and this needs no HDR download */}
      <Environment resolution={256} frames={1}>
        <color attach="background" args={["#efe6d4"]} />
        <Lightformer form="rect" intensity={3.2} color="#fff6e6" position={[0, 6, 2]} rotation={[Math.PI / 2, 0, 0]} scale={[10, 6, 1]} />
        <Lightformer form="rect" intensity={1.8} color="#ffe9c4" position={[-6, 2, 3]} rotation={[0, Math.PI / 2.4, 0]} scale={[5, 6, 1]} />
        <Lightformer form="rect" intensity={1.2} color="#f6efe2" position={[6, 2, 2]} rotation={[0, -Math.PI / 2.4, 0]} scale={[5, 6, 1]} />
        <Lightformer form="rect" intensity={0.5} color="#3b2f22" position={[0, -3, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[14, 14, 1]} />
        <Lightformer form="ring" intensity={2.2} color="#ffffff" position={[2, 3, 6]} scale={2.2} />
      </Environment>
      <Balance {...props} />
    </Canvas>
  );
}
