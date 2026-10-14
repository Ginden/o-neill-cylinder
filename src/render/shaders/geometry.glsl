const float EPS = 0.00005; // 5 cm; geometric offsets only, never an ambient source.
const float SOLAR_RADIUS = 0.00465048; // asin(R_sun / 1 au).
const float SUN_SOLID_ANGLE = 0.000067943107;

bool windowOpening(vec3 p) {
  if (abs(p.z) >= uLength*0.5-0.005) return false;
  float theta = atan(p.y,p.x);
  float phase = (theta+PI*0.5)/(2.0*PI/3.0);
  float margin = abs(fract(phase+0.5)-0.5)-(1.0-uWindowFraction)*0.5;
  float ring = abs(fract((p.z+uLength*0.5)/1.5+0.5)-0.5)*1.5;
  return margin*(2.0*PI/3.0)*uRadius>0.005 && ring>0.005;
}

vec4 glassIndexAtWavelength() {
  vec4 l2=wavelength*wavelength*1e-6;
  return sqrt(1.0+1.03961212*l2/(l2-0.00600069867)+0.231792344*l2/(l2-0.0200179144)+1.01046945*l2/(l2-103.560653));
}
// Thin-plate reflectance and transmittance at each path wavelength. A parallel
// plate does not bend rays, so all wavelengths keep one direction.
void glassPlate(float cosine,out vec4 reflectance,out vec4 transmittance) {
  float c = clamp(abs(cosine),0.0,1.0);
  vec4 eta=glassIndex;
  vec4 ct = sqrt(1.0-(1.0-c*c)/(eta*eta));
  vec4 rs = (c-eta*ct)/(c+eta*ct);
  vec4 rp = (eta*c-ct)/(eta*c+ct);
  vec4 f = 0.5*(rs*rs+rp*rp);
  vec4 attenuation=pow(vec4(uWindowTransmission),1.0/ct);
  vec4 denominator=max(vec4(1e-8),1.0-f*f*attenuation*attenuation);
  reflectance=f+(1.0-f)*(1.0-f)*f*attenuation*attenuation/denominator;
  transmittance=(1.0-f)*(1.0-f)*attenuation/denominator;
}

// Bound on the baked terrain slope |∇h|. A heightfield cannot rise toward a ray
// faster than TERRAIN_SLOPE × horizontal travel − vertical climb.
const float TERRAIN_SLOPE = 1.5;

float traceInterior(vec3 p, vec3 d) {
  float boundary = boundaryDistance(p,d);
  // The heightfield is bounded by 1.84 × relief, plus trees and roofs. Cross the
  // guaranteed empty interior analytically, retaining hits on both sides.
  float innerRadius=max(0.0,uRadius-1.84*uTerrainHeight-(uLandUse ? CANOPY_TOP : 0.0));
  float a=dot(d.xy,d.xy),b=dot(p.xy,d.xy);
  float discriminant=b*b-a*(dot(p.xy,p.xy)-innerRadius*innerRadius);
  float enter=1e20,leave=-1.0;
  if (a>1e-10 && discriminant>0.0) {
    float root=sqrt(discriminant);
    enter=max(0.0,(-b-root)/a);leave=(-b+root)/a;
  }
  float t = 0.0;
  float previous = 0.0;
  for (int i=0;i<320;i++) {
    if (t>=enter && t<leave-EPS && t<boundary) {
      previous=t;t=min(leave,boundary);continue;
    }
    vec3 q=p+d*t;
    float radius=length(q.xy);
    float phase=(atan(q.y,q.x)+PI*0.5)/SECTOR_ANGLE;
    float landDistance=radius*sin(((1.0-uWindowFraction)*0.5-abs(fract(phase+0.5)-0.5))*SECTOR_ANGLE);
    float above=uRadius-radius-terrainAt(q);
    float wall=min(uRadius-radius,uLength*0.5-abs(q.z));
    float kind;
    vec2 id;
    float object=objectDistance(q,above,kind,id);
    float sdf=min(min(wall,max(above,-landDistance)),object);
    if (sdf<EPS || t>=boundary) {
      if (sdf<0.0) {
        float lo=previous,hi=t;
        for (int j=0;j<12;j++) {
          float mid=(lo+hi)*0.5;
          if (surfaceDistance(p+d*mid)>0.0) lo=mid; else hi=mid;
        }
        t=(lo+hi)*0.5;
      }
      return min(t,boundary);
    }
    previous=t;
    float rise=-dot(d.xy,q.xy)/max(radius,1e-6);
    float approach=max(TERRAIN_SLOPE*sqrt(max(0.0,1.0-rise*rise))-rise,0.1);
    // The clipped terrain is an intersection: either bound separates it. The
    // hull is analytic, so rays leaving through a window step straight to it.
    float step=min(boundary-t,max(max(above,0.0)/approach,-landDistance));
    if (uLandUse && above>CANOPY_TOP+0.01) {
      // Trees and roofs lie within CANOPY_TOP of the terrain; empty occupancy
      // blocks guarantee 30 m of clearance in every direction.
      float canopy=(above-CANOPY_TOP)/approach;
      if (canopy<step && above<0.25 && dot(textureLod(uLandCover,atlasCoordinates(q),4.0).ab,vec2(1))==0.0) canopy=max(canopy,0.027);
      step=min(step,canopy);
    } else step=min(step,object*0.85);
    t+=max(EPS*0.5,min(step,uRadius/16.0));
  }
  // A grazing ray that exhausted the numerical budget must not leak sunlight.
  return min(t,boundary);
}

float mirrorHit(vec3 p, vec3 d, int index) {
  float denominator=dot(d,uMirrorNormal[index]);
  if (abs(denominator)<1e-7) return 1e20;
  float t=dot(uMirrorCenter[index]-p,uMirrorNormal[index])/denominator;
  if (t<=EPS) return 1e20;
  vec3 relative=p+d*t-uMirrorCenter[index];
  return abs(dot(relative,uMirrorAcross[index]))<=uMirrorSize.x && abs(dot(relative,uMirrorAlong[index]))<=uMirrorSize.y ? t : 1e20;
}

float shellHit(vec3 p, vec3 d) {
  float a=dot(d.xy,d.xy), b=dot(p.xy,d.xy), c=dot(p.xy,p.xy)-uRadius*uRadius;
  float disc=b*b-a*c;
  float t=1e20;
  if (a>1e-10 && disc>=0.0) {
    float root=sqrt(disc);
    float near=(-b-root)/a,far=(-b+root)/a;
    if (near>EPS && abs(p.z+d.z*near)<=uLength*0.5) t=near;
    else if (far>EPS && abs(p.z+d.z*far)<=uLength*0.5) t=far;
  }
  if (abs(d.z)>1e-10) for (int i=0;i<2;i++) {
    float z=i==0 ? -uLength*0.5 : uLength*0.5;
    float cap=(z-p.z)/d.z;
    if (cap>EPS && length((p+d*cap).xy)<=uRadius) t=min(t,cap);
  }
  return t;
}

// Trace the actual exterior geometry, including the reflecting face and blockers.
// Result contains throughput; outgoing direction can change at a mirror.
float exteriorPath(inout vec3 p, inout vec3 d) {
  float weight=1.0;
  for (int bounce=0;bounce<8;bounce++) {
    float closest=shellHit(p,d);
    int panel=-1;
    for (int i=0;i<3;i++) {
      if (i>=uMirrorCount) break;
      float t=mirrorHit(p,d,i);
      if (t<closest) {closest=t;panel=i;}
    }
    if (closest>1e19) return weight;
    if (panel<0 || dot(d,uMirrorNormal[panel])<=0.0) return 0.0;
    p+=d*closest;
    d=reflect(d,uMirrorNormal[panel]);
    p+=d*(EPS*4.0);
    weight*=uMirrorReflectivity;
  }
  return 0.0;
}

// Light on the raster preview is cached in a surface atlas: the wall (ground
// angle × axial position, as atlasCoordinates) fills the lower two thirds, and
// the endcaps at z = −L/2 and +L/2, as x–y squares, the left and right halves
// of the top third.
const float ATLAS_WALL=2.0/3.0;
vec2 surfaceAtlasCoordinates(vec3 p,bool endcap) {
  if (endcap) {
    vec2 square=clamp(p.xy/(2.0*uRadius)+0.5,0.0,1.0);
    return vec2((square.x+(p.z>0.0 ? 1.0 : 0.0))*0.5,ATLAS_WALL+square.y*(1.0-ATLAS_WALL));
  }
  vec2 uv=atlasCoordinates(p);
  return vec2(uv.x,uv.y*ATLAS_WALL);
}
// Filtered atlas lookup, offset by whole texels, that stays within the texel
// centres of one region: the wall (which wraps around) or one endcap.
vec3 surfaceAtlasLight(sampler2D atlas,vec2 uv,bool endcap,vec2 offset) {
  vec2 size=vec2(textureSize(atlas,0)),margin=0.5/size;
  vec2 low=endcap ? vec2(uv.x<0.5 ? 0.0 : 0.5,ATLAS_WALL) : vec2(-1e3,0.0);
  vec2 high=endcap ? low+vec2(0.5,1.0-ATLAS_WALL) : vec2(1e3,ATLAS_WALL);
  return textureLod(atlas,clamp(uv+offset/size,low+margin,high-margin),0.0).rgb;
}
// The surface point at atlas coordinates `uv`: on the terrain, on a pane or
// frame, or on an endcap. False outside the endcap discs.
bool surfaceAtlasPoint(vec2 uv,out vec3 p) {
  if (uv.y<ATLAS_WALL) {
    float theta=uv.x*2.0*PI+PI*0.5,z=(uv.y/ATLAS_WALL-0.5)*uLength;
    float height=windowAt(theta) ? 0.0 : terrainAtGround(vec2(uv.x*2.0*PI*uRadius,z));
    p=vec3(vec2(cos(theta),sin(theta))*(uRadius-height),z);
    return true;
  }
  vec2 square=vec2(fract(uv.x*2.0),(uv.y-ATLAS_WALL)/(1.0-ATLAS_WALL));
  p=vec3((square-0.5)*2.0*uRadius,uv.x<0.5 ? -uLength*0.5 : uLength*0.5);
  return length(p.xy)<uRadius;
}

vec3 interiorNormal(vec3 p) {
  if (abs(p.z)>=uLength*0.5-0.001) return vec3(0,0,-sign(p.z));
  if (windowAt(atan(p.y,p.x)) && abs(length(p.xy)-uRadius)<0.001) return -normalize(vec3(p.xy,0));
  return surfaceNormal(p);
}

// Endcaps: concrete and steel structure with concentric service terraces,
// radial ribs and panel-to-panel variation.
vec3 endcapAlbedo(vec3 p) {
  float radius=length(p.xy),angle=atan(p.y,p.x);
  float terrace=fract(radius/0.25);
  float rib=abs(fract(angle/(PI/12.0)+0.5)-0.5)*PI/12.0*radius;
  vec2 panel=floor(vec2(radius/0.06,angle*radius/0.06));
  vec3 color=vec3(0.23,0.28,0.3)*(0.85+0.3*hash(panel+vec2(p.z>0.0 ? 7.0 : 3.0,0.0)));
  color=mix(color,vec3(0.12,0.13,0.13),1.0-smoothstep(0.0,0.06,terrace));
  return mix(color,vec3(0.36,0.37,0.36),1.0-smoothstep(0.004,0.008,rib));
}

vec3 materialAlbedo(vec3 p, vec3 n, float kind, vec2 id) {
  if (abs(p.z)>=uLength*0.5-0.001) return endcapAlbedo(p);
  if (windowAt(atan(p.y,p.x)) && abs(length(p.xy)-uRadius)<0.001) return vec3(0.38,0.43,0.46);
  return kind>0.5 ? objectAlbedo(p,kind,id) : groundAlbedo(p,n);
}
vec3 surfaceAlbedo(vec3 p, vec3 n) {
  vec2 id;
  float kind=landKind(p,id);
  return materialAlbedo(p,n,kind,id);
}

// Shading normal: smooth terrain slopes with metre-scale relief, and leaf
// clumps on crowns. The geometric normal still offsets and bounds new rays.
vec3 shadingNormal(vec3 p,vec3 geometric,float kind,vec2 id) {
  if (abs(length(p.xy)-uRadius)<0.001) return geometric;
  if (kind<0.5) {
    // Exposed terrace faces keep their angular normals.
    if (abs(dot(geometric.xy,normalize(p.xy)))<0.7) return geometric;
    return terrainShadingNormal(p);
  }
  if (kind>1.5) return geometric;
  vec2 g=groundCoordinates(p)*1300.0;
  vec3 clumps=vec3(noise(g),noise(g+31.0),noise(g+57.0))-0.5;
  return normalize(geometric+clumps*0.9);
}
