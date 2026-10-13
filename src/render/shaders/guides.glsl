uniform mat4 uInverseProjection;
uniform mat4 uCameraMatrix;
uniform vec3 uCameraPosition;
uniform vec2 uResolution;
layout(location=0) out vec4 outGeometry;
layout(location=1) out vec4 outAlbedo;
// Filtering domains: 0 terrain, 1 endcap, 2 water, 3 pane or frame, 4 tree, 5 building.
// A subpixel frame shares the pane's filtering domain. Tagging only openings
// made isolated ring pixels diffuse, demodulating volume light as roof color.
float guideKind(vec3 hit,float land) {
  if (abs(hit.z)>uLength*0.5-0.001) return 1.0;
  if (windowAt(atan(hit.y,hit.x)) && abs(length(hit.xy)-uRadius)<0.001) return 3.0;
  if (land>0.5) return land>1.5 ? 5.0 : 4.0;
  return riverEdge(groundCoordinates(hit))<0.0 ? 2.0 : 0.0;
}
void main() {
  vec3 normal=vec3(0.0),albedo=vec3(0.0);
  float depth=0.0,kind=0.0;
  bool mixed=false;
  // The center ray sets geometry. Quadrant rays detect mixed coverage and
  // average the reflectance that jittered paths see: a central-ray material
  // alone cannot demodulate a pixel straddling terrain, water or a pane.
  for (int i=0;i<5;i++) {
    vec2 offset=i==0 ? vec2(0.0) : vec2((i-1)&1,(i-1)>>1)*0.5-0.25;
    vec2 ndc=(gl_FragCoord.xy+offset)/uResolution*2.0-1.0;
    vec4 view=uInverseProjection*vec4(ndc,1.0,1.0);
    vec3 ray=normalize((uCameraMatrix*vec4(normalize(view.xyz/view.w),0.0)).xyz);
    vec3 hit=uCameraPosition+ray*traceInterior(uCameraPosition,ray);
    vec2 id;
    float land=landKind(hit,id);
    float hitKind=guideKind(hit,land);
    vec3 hitNormal=interiorNormal(hit);
    if (i==0) {
      kind=hitKind;normal=hitNormal;depth=length(hit-uCameraPosition);
      continue;
    }
    mixed=mixed || hitKind!=kind;
    // Specular water and glass are not demodulated by a diffuse reflectance.
    albedo+=(hitKind==2.0 || hitKind==3.0 ? vec3(1.0) : materialAlbedo(hit,hitNormal,land,id))*0.25;
  }
  outGeometry=vec4(normal,depth);
  outAlbedo=vec4(albedo,mixed ? -1.0 : kind);
}
