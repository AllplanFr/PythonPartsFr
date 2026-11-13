using System;
using System.Text;

public static class ArgumentWitness
{
    public static int Main(string[] args)
    {
        Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(Environment.CurrentDirectory)));
        foreach (string arg in args)
            Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(arg)));
        return 0;
    }
}
