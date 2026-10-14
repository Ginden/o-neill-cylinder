// One red-black SOR half-sweep for the steady diffusion equation
// -∇·(D∇Φ) + σ_a Φ = 0 in deep cache cells, at the four node wavelengths.
// Deep cloud lies far from direct sunlight, so it has no source; neighboring
// transport cells supply boundary values. Finite volumes on the cylindrical
// grid of cache.glsl; Fick's law F = -D∇Φ gives the cached flux.
uniform sampler2D uFluence;
uniform sampler2D uFlux;
uniform sampler2D uDiffusion;
uniform sampler2D uAbsorption;
uniform float uRadius;
uniform float uLength;
uniform int uColor;
uniform float uRelaxation;
layout(location=0) out vec4 outFluence;
layout(location=1) out vec4 outFlux;
const float PI=3.141592653589793;
const int RADIAL=32,ANGULAR=96,AXIAL=64;

ivec2 texelOf(int i,int j,int k) {return ivec2((j+ANGULAR)%ANGULAR,i+k*RADIAL);}
float outerRadius(int i) {float u=float(i)/float(RADIAL);return uRadius*(1.0-u*u);}
float centerRadius(int i) {return 0.5*(outerRadius(i)+outerRadius(i+1));}

vec4 fluenceAt(int i,int j,int k) {return texelFetch(uFluence,texelOf(i,j,k),0);}

void main() {
  ivec2 texel=ivec2(gl_FragCoord.xy);
  int j=texel.x,i=texel.y%RADIAL,k=texel.y/RADIAL;
  vec4 fluence=texelFetch(uFluence,texel,0),flux=texelFetch(uFlux,texel,0);
  vec4 diffusion=texelFetch(uDiffusion,texel,0);
  outFluence=fluence;outFlux=flux;
  if (diffusion.x<=0.0 || (i+j+k)%2!=uColor) return;
  float dTheta=2.0*PI/float(ANGULAR),dz=uLength/float(AXIAL);
  float outer=outerRadius(i),inner=outerRadius(i+1),r=centerRadius(i);
  float volume=0.5*(outer*outer-inner*inner)*dTheta*dz;
  float theta=(float(j)+0.5)*dTheta;
  vec3 radial=vec3(cos(theta),sin(theta),0.0),tangent=vec3(-sin(theta),cos(theta),0.0);
  vec4 sum=vec4(0.0),conductance=vec4(0.0);
  // Deep cells are never at the wall or next to an endcap (cache.ts), so those
  // neighbors exist; at the axis the innermost face has no area.
  for (int n=0;n<6;n++) {
    ivec3 offset=n==0 ? ivec3(-1,0,0) : n==1 ? ivec3(1,0,0) : n==2 ? ivec3(0,1,0) : n==3 ? ivec3(0,-1,0) : n==4 ? ivec3(0,0,1) : ivec3(0,0,-1);
    int ni=i+offset.x;
    if (ni>=RADIAL) continue; // The axis: the innermost face has no area.
    // Face area, distance between centers, distance to the face, outward normal.
    float area,distance,gap;
    vec3 normal;
    if (n==0) {area=outer*dTheta*dz;distance=centerRadius(ni)-r;gap=outer-r;normal=radial;}
    else if (n==1) {area=inner*dTheta*dz;distance=r-centerRadius(ni);gap=r-inner;normal=-radial;}
    else if (n<4) {area=(outer-inner)*dz;distance=r*dTheta;gap=0.5*distance;normal=float(offset.y)*tangent;}
    else {area=0.5*(outer*outer-inner*inner)*dTheta;distance=dz;gap=0.5*dz;normal=vec3(0,0,offset.z);}
    ivec2 neighbor=texelOf(ni,j+offset.y,k+offset.z);
    vec4 other=texelFetch(uDiffusion,neighbor,0),value=texelFetch(uFluence,neighbor,0);
    if (other.x>0.0) {
      vec4 face=area/distance*2.0*diffusion*other/(diffusion+other);
      sum+=face*value;conductance+=face;
    } else {
      // A transport cell: light enters with its P1 partial current; the Marshak
      // condition J_in = Φ/4 − J·n/2 on this face gives a conductance toward 4 J_in.
      // Coupling through currents rather than values lets deep cloud reflect
      // light in one solve instead of over many cache iterations.
      // A noisy flux estimate is limited to |F| ≤ Φ/2, where the partial current
      // stays non-negative; clamping the current instead would add energy.
      vec3 neighborFlux=texelFetch(uFlux,neighbor,0).xyz;
      float total=dot(value,vec4(1.0)),strength=length(neighborFlux);
      float drift=strength>0.0 ? min(0.5,strength/max(total,1e-30))*dot(neighborFlux/strength,normal) : 0.0;
      vec4 entering=value*(0.25-0.5*drift);
      vec4 face=area*diffusion/(gap+2.0*diffusion);
      sum+=face*4.0*entering;conductance+=face;
    }
  }
  vec4 relaxed=sum/(conductance+texelFetch(uAbsorption,texel,0)*volume);
  outFluence=mix(fluence,relaxed,uRelaxation);
  // Flux of the node sum from central differences, in Cartesian axes.
  vec4 outerValue=fluenceAt(i-1,j,k),innerValue=i+1<RADIAL ? fluenceAt(i+1,j,k) : outFluence;
  float radialSpan=centerRadius(i-1)-(i+1<RADIAL ? centerRadius(i+1) : r);
  vec3 gradient=vec3(
    dot(diffusion,outerValue-innerValue)/radialSpan,
    dot(diffusion,fluenceAt(i,j+1,k)-fluenceAt(i,j-1,k))/(2.0*r*dTheta),
    dot(diffusion,fluenceAt(i,j,k+1)-fluenceAt(i,j,k-1))/(2.0*dz));
  outFlux=vec4(-(gradient.x*radial+gradient.y*tangent+gradient.z*vec3(0,0,1)),1.0);
}
