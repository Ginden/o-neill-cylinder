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

float glassIndexAtWavelength() {
  float l2=pow(wavelength*0.001,2.0);
  return sqrt(1.0+1.03961212*l2/(l2-0.00600069867)+0.231792344*l2/(l2-0.0200179144)+1.01046945*l2/(l2-103.560653));
}
vec2 glassPlate(float cosine) {
  float c = clamp(abs(cosine),0.0,1.0);
  float eta=glassIndex;
  float ct = sqrt(1.0-(1.0-c*c)/(eta*eta));
  float rs = (c-eta*ct)/(c+eta*ct);
  float rp = (eta*c-ct)/(eta*c+ct);
  float f = 0.5*(rs*rs+rp*rp);
  float attenuation=pow(uWindowTransmission,1.0/ct);
  float denominator=max(1e-8,1.0-f*f*attenuation*attenuation);
  return vec2(f+(1.0-f)*(1.0-f)*f*attenuation*attenuation/denominator,
    (1.0-f)*(1.0-f)*attenuation/denominator);
}

float traceInterior(vec3 p, vec3 d) {
  float boundary = boundaryDistance(p,d);
  // The heightfield is bounded by 1.84 × relief. Cross the guaranteed empty
  // interior analytically, retaining terrain intersections on both sides.
  float innerRadius=max(0.0,uRadius-1.84*uTerrainHeight);
  float a=dot(d.xy,d.xy),b=dot(p.xy,d.xy);
  float discriminant=b*b-a*(dot(p.xy,p.xy)-innerRadius*innerRadius);
  float enter=1e20,leave=-1.0;
  if (a>1e-10 && discriminant>0.0) {
    float root=sqrt(discriminant);
    enter=max(0.0,(-b-root)/a);leave=(-b+root)/a;
  }
  float t = 0.0;
  float previous = 0.0;
  for (int i=0;i<256;i++) {
    if (t>=enter && t<leave-EPS && t<boundary) {
      previous=t;t=min(leave,boundary);continue;
    }
    float sdf = surfaceDistance(p+d*t);
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
    t+=max(EPS*0.5,min(sdf*0.35,uRadius/16.0));
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

vec3 interiorNormal(vec3 p) {
  if (abs(p.z)>=uLength*0.5-0.001) return vec3(0,0,-sign(p.z));
  if (windowAt(atan(p.y,p.x))) return -normalize(vec3(p.xy,0));
  return surfaceNormal(p);
}

vec3 surfaceAlbedo(vec3 p, vec3 n) {
  if (abs(p.z)>=uLength*0.5-0.001) return vec3(0.23,0.28,0.3);
  if (windowAt(atan(p.y,p.x))) return vec3(0.38,0.43,0.46);
  return groundAlbedo(p,n);
}
