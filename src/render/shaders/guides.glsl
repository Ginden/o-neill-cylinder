uniform mat4 uInverseProjection;
uniform mat4 uCameraMatrix;
uniform vec3 uCameraPosition;
uniform vec2 uResolution;
layout(location=0) out vec4 outGeometry;
layout(location=1) out vec4 outAlbedo;
vec3 guideHit(vec2 pixel) {
  vec2 ndc=pixel/uResolution*2.0-1.0;
  vec4 view=uInverseProjection*vec4(ndc,1.0,1.0);
  vec3 ray=normalize((uCameraMatrix*vec4(normalize(view.xyz/view.w),0.0)).xyz);
  float distance=traceInterior(uCameraPosition,ray);
  return uCameraPosition+ray*distance;
}
float guideKind(vec3 hit) {
  // A subpixel frame shares the pane's filtering domain. Tagging only openings
  // made isolated ring pixels diffuse, demodulating volume light as roof color.
  return abs(hit.z)>uLength*0.5-0.001 ? 1.0 : windowAt(atan(hit.y,hit.x)) && abs(length(hit.xy)-uRadius)<0.001 ? 3.0 :
    riverDistance(groundCoordinates(hit))<0.035 ? 2.0 : 0.0;
}
void main() {
  vec3 hit=guideHit(gl_FragCoord.xy),normal=interiorNormal(hit);
  float kind=guideKind(hit);
  vec3 albedo=vec3(0.0);bool mixed=false;
  for(int y=0;y<2;y++) for(int x=0;x<2;x++) {
    vec3 other=guideHit(gl_FragCoord.xy+vec2(x,y)*0.5-0.25);
    mixed=mixed || guideKind(other)!=kind;
    albedo+=surfaceAlbedo(other,interiorNormal(other))*0.25;
  }
  // Jittered radiance contains all covered materials. A central-ray material
  // alone cannot demodulate a pixel straddling terrain, water or a pane.
  outGeometry=vec4(normal,length(hit-uCameraPosition));
  outAlbedo=vec4(albedo,mixed ? -1.0 : kind);
}
