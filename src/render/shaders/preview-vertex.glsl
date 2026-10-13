uniform float uRadius;
uniform float uLength;
uniform float uWindowFraction;
uniform sampler2D uTerrain;
uniform int uSurfaceKind;
out vec3 vWorld;
void main() {
  vec3 p=position;
  float theta=atan(p.y,p.x);
  float phase=(theta+1.57079632679)/2.09439510239;
  bool window=abs(fract(phase+0.5)-0.5)>(1.0-uWindowFraction)*0.5;
  float height=uSurfaceKind==0 && !window ? texture(uTerrain,vec2(mod(theta-1.57079632679,6.28318530718)/6.28318530718,p.z+0.5)).r : 0.0;
  p.xy*=uRadius-height;p.z*=uLength;
  vWorld=p;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
}
