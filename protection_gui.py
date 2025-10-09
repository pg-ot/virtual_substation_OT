#!/usr/bin/env python3
import tkinter as tk
from tkinter import ttk
import sys
import signal
import os

class ProtectionIED:
    def __init__(self, interface="enp0s3"):
        self.root = tk.Tk()
        self.root.title("Protection IED - GOOSE Publisher")
        self.root.geometry("400x400")
        
        self.interface = interface
        self.trip_var = tk.BooleanVar()
        self.close_var = tk.BooleanVar()
        self.fault_type = tk.IntVar(value=0)
        self.prot_element = tk.IntVar(value=50)
        self.current = tk.DoubleVar(value=1250.5)
        self.voltage = tk.DoubleVar(value=10500.0)
        self.frequency = tk.DoubleVar(value=49.8)
        
        self.setup_gui()
        self.update_publisher_data()
        
    def setup_gui(self):
        tk.Label(self.root, text="Protection IED Control", font=("Arial", 16, "bold")).pack(pady=10)
        tk.Label(self.root, text=f"Interface: {self.interface}", font=("Arial", 10)).pack()
        
        # Commands
        cmd_frame = tk.LabelFrame(self.root, text="Protection Commands", padx=10, pady=10)
        cmd_frame.pack(fill="x", padx=10, pady=5)
        
        tk.Checkbutton(cmd_frame, text="Trip Command", variable=self.trip_var, 
                      font=("Arial", 12), fg="red").pack(anchor="w")
        tk.Checkbutton(cmd_frame, text="Close Command", variable=self.close_var,
                      font=("Arial", 12), fg="green").pack(anchor="w")
        
        # Fault Info
        fault_frame = tk.LabelFrame(self.root, text="Fault Information", padx=10, pady=10)
        fault_frame.pack(fill="x", padx=10, pady=5)
        
        tk.Label(fault_frame, text="Fault Type:").pack(anchor="w")
        ttk.Combobox(fault_frame, textvariable=self.fault_type, 
                    values=[0, 1, 2, 3], state="readonly", width=20).pack(anchor="w")
        tk.Label(fault_frame, text="0=No Fault, 1=Overcurrent, 2=Differential, 3=Distance", 
                font=("Arial", 8)).pack(anchor="w")
        
        # Measurements
        meas_frame = tk.LabelFrame(self.root, text="Measurements", padx=10, pady=10)
        meas_frame.pack(fill="x", padx=10, pady=5)
        
        tk.Label(meas_frame, text="Current (A):").pack(anchor="w")
        self.current_label = tk.Label(meas_frame, text=f"{self.current.get():.1f} A")
        self.current_label.pack(anchor="w")
        self.current_scale = tk.Scale(meas_frame, from_=0, to=5000, orient="horizontal", variable=self.current,
                resolution=0.1, length=300, troughcolor="green")
        self.current_scale.pack(fill="x")
        
        tk.Label(meas_frame, text="Voltage (V):").pack(anchor="w")
        self.voltage_label = tk.Label(meas_frame, text=f"{self.voltage.get():.0f} V")
        self.voltage_label.pack(anchor="w")
        self.voltage_scale = tk.Scale(meas_frame, from_=0, to=15000, orient="horizontal", variable=self.voltage,
                resolution=100, length=300, troughcolor="green")
        self.voltage_scale.pack(fill="x")
        
        tk.Label(meas_frame, text="Frequency (Hz):").pack(anchor="w")
        self.freq_label = tk.Label(meas_frame, text=f"{self.frequency.get():.1f} Hz")
        self.freq_label.pack(anchor="w")
        self.freq_scale = tk.Scale(meas_frame, from_=45.0, to=55.0, orient="horizontal", variable=self.frequency,
                resolution=0.1, length=300, troughcolor="green")
        self.freq_scale.pack(fill="x")
        
        # Protection Status
        status_frame = tk.LabelFrame(self.root, text="Protection Status", padx=10, pady=5)
        status_frame.pack(fill="x", padx=10, pady=5)
        
        tk.Label(status_frame, text="Current: Normal <2000A, Abnormal 2000-3500A, Fault >3500A", 
                font=("Arial", 8)).pack(anchor="w")
        tk.Label(status_frame, text="Voltage: Normal 10-12kV, Abnormal 8-10kV/12-14kV, Fault <8kV/>14kV", 
                font=("Arial", 8)).pack(anchor="w")
        tk.Label(status_frame, text="Frequency: Normal 49.5-50.5Hz, Abnormal 49-49.5Hz/50.5-51Hz, Fault <49Hz/>51Hz", 
                font=("Arial", 8)).pack(anchor="w")
        
        tk.Label(self.root, text="Publishing GOOSE Messages", 
                font=("Arial", 12, "bold"), fg="green").pack(pady=10)
        
        self.update_labels()
        
    def update_labels(self):
        self.current_label.config(text=f"{self.current.get():.1f} A")
        self.voltage_label.config(text=f"{self.voltage.get():.0f} V")
        self.freq_label.config(text=f"{self.frequency.get():.1f} Hz")
        self.root.after(100, self.update_labels)
        
    def update_publisher_data(self):
        data = f"{int(self.trip_var.get())},{int(self.close_var.get())},{self.fault_type.get()},{self.prot_element.get()},{self.current.get()},{self.voltage.get()},{self.frequency.get()}\n"
        try:
            with open('/tmp/gui_data.txt', 'w') as f:
                f.write(data)
        except:
            pass
        self.update_slider_colors()
        self.root.after(100, self.update_publisher_data)
        
    def update_slider_colors(self):
        # Current: Normal <2000A, Abnormal 2000-3500A, Fault >3500A
        current = self.current.get()
        if current < 2000:
            self.current_scale.config(troughcolor="green")
        elif current < 3500:
            self.current_scale.config(troughcolor="yellow")
        else:
            self.current_scale.config(troughcolor="red")
            
        # Voltage: Normal 10-12kV, Abnormal 8-10kV or 12-14kV, Fault <8kV or >14kV
        voltage = self.voltage.get()
        if 10000 <= voltage <= 12000:
            self.voltage_scale.config(troughcolor="green")
        elif (8000 <= voltage < 10000) or (12000 < voltage <= 14000):
            self.voltage_scale.config(troughcolor="yellow")
        else:
            self.voltage_scale.config(troughcolor="red")
            
        # Frequency: Normal 49.5-50.5Hz, Abnormal 49-49.5Hz or 50.5-51Hz, Fault <49Hz or >51Hz
        freq = self.frequency.get()
        if 49.5 <= freq <= 50.5:
            self.freq_scale.config(troughcolor="green")
        elif (49.0 <= freq < 49.5) or (50.5 < freq <= 51.0):
            self.freq_scale.config(troughcolor="yellow")
        else:
            self.freq_scale.config(troughcolor="red")
        
    def cleanup(self, signum=None, frame=None):
        try:
            os.remove('/tmp/gui_data.txt')
        except:
            pass
        self.root.quit()
        sys.exit(0)
        
    def run(self):
        signal.signal(signal.SIGINT, self.cleanup)
        signal.signal(signal.SIGTERM, self.cleanup)
        try:
            self.root.protocol("WM_DELETE_WINDOW", self.cleanup)
            self.root.mainloop()
        except KeyboardInterrupt:
            self.cleanup()

if __name__ == "__main__":
    interface = sys.argv[1] if len(sys.argv) > 1 else "enp0s3"
    app = ProtectionIED(interface)
    app.run()