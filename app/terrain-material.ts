import * as THREE from 'three';
import type { BuildingOverlay } from './building-overlay';

// Surface detail is illustrative. Elevation and mapped water geometry remain
// untouched; this shader only changes colour, roughness and lighting normals.
export function landscapeMaterial(geography: THREE.Texture, origin: THREE.Vector2, buildings?: BuildingOverlay['uniforms']) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .94 });
  material.customProgramCacheKey = () => buildings ? 'himalaya-landscape-buildings-v1' : 'himalaya-landscape-v2';
  material.onBeforeCompile = shader => {
    if (buildings) Object.assign(shader.uniforms, buildings);
    shader.uniforms.geographyMap = { value: geography };
    shader.uniforms.terrainOrigin = { value: origin };
    shader.vertexShader = `varying vec2 vGeographyUv;
varying vec3 vLandscapePosition;
${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
vGeographyUv = uv;
vLandscapePosition = position;`);
    const buildingDeclarations = buildings ? `uniform sampler2D buildingDensity;
uniform sampler2D buildingDetail;
uniform sampler2D geographyDetail;
uniform vec4 buildingRect;
uniform float buildingDetailReady;
uniform float buildingsVisible;` : '';
    const buildingColour = buildings ? `
vec4 built = texture2D(buildingDensity, vGeographyUv);
vec2 buildingUv = (vGeographyUv - buildingRect.xy) / (buildingRect.zw - buildingRect.xy);
float detailBlend = 0.0;
if (buildingDetailReady > .5 && all(greaterThanEqual(buildingUv,vec2(0.0))) && all(lessThanEqual(buildingUv,vec2(1.0)))) {
  vec2 edgeDistance = min(buildingUv,1.0-buildingUv);
  detailBlend = smoothstep(0.0,.08,min(edgeDistance.x,edgeDistance.y));
  built = mix(built,texture2D(buildingDetail, buildingUv),detailBlend);
}
diffuseColor.rgb = mix(diffuseColor.rgb,built.rgb,built.a * buildingsVisible);
` : '';
    shader.fragmentShader = `${buildingDeclarations}
uniform sampler2D geographyMap;
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
${buildingColour}
vec4 mapped = texture2D(geographyMap, vGeographyUv);
${buildings ? 'if (detailBlend > 0.0) mapped = mix(mapped,texture2D(geographyDetail,buildingUv),detailBlend);' : ''}
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
