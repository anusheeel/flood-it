import * as THREE from 'three';

// Surface detail is illustrative. Elevation and mapped water geometry remain
// untouched; this shader only changes colour, roughness and lighting normals.
export function landscapeMaterial(geography: THREE.Texture, origin: THREE.Vector2) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .94 });
  material.customProgramCacheKey = () => 'himalaya-landscape-v2';
  material.onBeforeCompile = shader => {
    shader.uniforms.geographyMap = { value: geography };
    shader.uniforms.terrainOrigin = { value: origin };
    shader.vertexShader = `varying vec2 vGeographyUv;
varying vec3 vLandscapePosition;
${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
vGeographyUv = uv;
vLandscapePosition = position;`);
    shader.fragmentShader = `uniform sampler2D geographyMap;
uniform vec2 terrainOrigin;
varying vec2 vGeographyUv;
varying vec3 vLandscapePosition;
float landHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float landNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(landHash(i),landHash(i+vec2(1.0,0.0)),f.x),
    mix(landHash(i+vec2(0.0,1.0)),landHash(i+vec2(1.0,1.0)),f.x),f.y);
}
float landDetail(vec2 p) {
  return .52*landNoise(p)+.28*landNoise(p*2.07)+.14*landNoise(p*4.19)+.06*landNoise(p*8.37);
}
vec3 landBump(vec3 surface, vec3 surfaceNormal, vec2 gradient, float facing) {
  vec3 dx = normalize(dFdx(surface)), dy = normalize(dFdy(surface));
  vec3 rx = cross(dy,surfaceNormal), ry = cross(surfaceNormal,dx);
  float det = dot(dx,rx)*facing;
  return normalize(abs(det)*surfaceNormal-sign(det)*(gradient.x*rx+gradient.y*ry));
}
${shader.fragmentShader}`
      .replace('#include <color_fragment>', `#include <color_fragment>
vec2 landCoord = vLandscapePosition.xz + terrainOrigin;
float landGrain = landDetail(landCoord*5.5 + vLandscapePosition.y*.8);
float landFine = landNoise(landCoord*62.0);
float landSnow = smoothstep(.55,.85,max(diffuseColor.r,max(diffuseColor.g,diffuseColor.b)));
diffuseColor.rgb *= mix(.76 + .42*landGrain + .10*landFine, .96 + .07*landGrain, landSnow);
vec4 mapped = texture2D(geographyMap, vGeographyUv);
float mappedWater = smoothstep(.03,.12,mapped.b-mapped.r)*mapped.a;
diffuseColor.rgb = mix(diffuseColor.rgb,mapped.rgb,mapped.a);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
float landRelief = (landGrain*.010 + landFine*.0008)*(1.0-mappedWater)*(1.0-landSnow*.8);
normal = landBump(-vViewPosition,normal,vec2(dFdx(landRelief),dFdy(landRelief)),faceDirection);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor,.36,mappedWater);`);
  };
  return material;
}

export function landscapeSky() {
  return new THREE.Mesh(new THREE.SphereGeometry(1,32,16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      zenith: { value: new THREE.Color('#477fa2') },
      horizon: { value: new THREE.Color('#b9ccd2') },
    },
    vertexShader: `varying vec3 skyDirection;
void main() { skyDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; varying vec3 skyDirection;
void main() {
  float altitude = max(0.0,normalize(skyDirection).y);
  gl_FragColor = vec4(mix(horizon,zenith,pow(altitude,.48)),1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  }));
}
