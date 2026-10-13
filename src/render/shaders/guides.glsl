uniform mat4 uInverseProjection;
uniform mat4 uCameraMatrix;
uniform vec3 uCameraPosition;
uniform vec2 uResolution;
layout(location=0) out vec4 outGeometry;
layout(location=1) out vec4 outAlbedo;
void main() {
  vec2 ndc=gl_FragCoord.xy/uResolution*2.0-1.0;
  vec4 view=uInverseProjection*vec4(ndc,1.0,1.0);
  vec3 ray=normalize((uCameraMatrix*vec4(normalize(view.xyz/view.w),0.0)).xyz);
  float distance=traceInterior(uCameraPosition,ray);
  vec3 hit=uCameraPosition+ray*distance;
  vec3 normal=interiorNormal(hit);
  float kind=abs(hit.z)>uLength*0.5-0.001 ? 1.0 : windowOpening(hit) ? 3.0 :
    riverDistance(groundCoordinates(hit))<0.035 ? 2.0 : 0.0;
  outGeometry=vec4(normal,distance);
  outAlbedo=vec4(surfaceAlbedo(hit,normal),kind);
}
