uniform vec2 uPreviewAtlasSize;
out vec4 outColor;
void main() {
  wavelength=vec4(550.0);spectralBin=vec4(17.0);glassIndex=glassIndexAtWavelength();
  vec2 uv=gl_FragCoord.xy/uPreviewAtlasSize;
  float theta=uv.x*2.0*PI+PI*0.5;
  float height=windowAt(theta) ? 0.0 : texture(uTerrain,uv).r;
  vec3 point=vec3(vec2(cos(theta),sin(theta))*(uRadius-height),(uv.y-0.5)*uLength);
  vec3 normal=interiorNormal(point);
  vec3 p=point+normal*0.001;
  float light=0.0;
  for (int source=0;source<4;source++) {
    if (source>uMirrorCount) break;
    vec3 direction=source==0 ? uSun : reflect(uSun,uMirrorNormal[source-1]);
    float cosine=max(0.0,dot(normal,direction));
    if (cosine==0.0) continue;
    float distance=boundaryDistance(p,direction);
    vec3 exit=p+direction*distance;
    if (!windowOpening(exit)) continue;
    vec3 outsidePoint=exit+direction*0.001,outsideDirection=direction;
    float exterior=exteriorPath(outsidePoint,outsideDirection);
    if (exterior==0.0 || dot(outsideDirection,uSun)<0.999999) continue;
    float column=0.0;
    if (uAtmosphere) for(int i=0;i<8;i++) column+=airDensity(p+direction*distance*(float(i)+0.5)/8.0)*distance/8.0;
    vec4 reflectance,transmittance;
    glassPlate(dot(normalize(exit.xy),direction.xy),reflectance,transmittance);
    light+=cosine*exterior*transmittance.x*exp(-(0.013558+uAerosol)*column);
  }
  outColor=vec4(vec3(light*uSolarPower),1.0);
}
